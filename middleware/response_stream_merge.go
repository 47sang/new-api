package middleware

import (
	"bufio"
	"encoding/json"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// maxSSEScanTokenSize 单行 SSE data 载荷的最大字节数。
// bufio.Scanner 默认 64KB 上限对携带 base64 图片等大载荷的流式分片不够用
const maxSSEScanTokenSize = 32 << 20

// parseSSEDataPayloads 从原始 SSE 报文中提取全部 data 载荷
// 按 SSE 规范处理：空行分隔事件、同一事件内多个 data: 行以 \n 连接、
// 忽略 event:/id:/retry:/注释行，跳过 [DONE] 结束标记
func parseSSEDataPayloads(raw string) []string {
	var payloads []string
	var dataLines []string
	flush := func() {
		if len(dataLines) > 0 {
			payloads = append(payloads, strings.Join(dataLines, "\n"))
			dataLines = dataLines[:0]
		}
	}

	sc := bufio.NewScanner(strings.NewReader(raw))
	sc.Buffer(make([]byte, 0, 64*1024), maxSSEScanTokenSize)
	for sc.Scan() {
		line := strings.TrimSuffix(sc.Text(), "\r")
		if line == "" {
			flush()
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		// SSE 规范：冒号后最多一个空格属于分隔符
		value := strings.TrimPrefix(line[len("data:"):], " ")
		if value == "[DONE]" {
			continue
		}
		dataLines = append(dataLines, value)
	}
	flush()

	// scanner 提前终止（如单行超过 32MB 上限）时输出告警，
	// 避免合并结果看似完整而实际静默截断了后续分片
	if err := sc.Err(); err != nil {
		common.SysLog("request/response stream merge stopped early, saved log may be truncated: " + err.Error())
	}
	return payloads
}

// decodeStreamPayload 解析 SSE 载荷到 v，容忍个别字段类型不符：
// 载荷为合法 JSON 对象时，encoding/json 会跳过类型不符的字段、保留其余已解析字段；
// 载荷本身不是合法 JSON 对象（截断、数组、纯字符串等）时返回 false，由调用方跳过该载荷
func decodeStreamPayload(payload string, v any) bool {
	if common.UnmarshalJsonStr(payload, v) == nil {
		return true
	}
	var probe map[string]any
	return common.UnmarshalJsonStr(payload, &probe) == nil
}

// mergeExtraValue 扩展字段合并规则：均为字符串→拼接；均为数组→拼接；
// 均为对象→递归合并（数组键拼接，如 logprobs.content）；其余→取新值
func mergeExtraValue(dst, value any) any {
	switch d := dst.(type) {
	case string:
		if v, ok := value.(string); ok {
			return d + v
		}
	case []any:
		if v, ok := value.([]any); ok {
			return append(d, v...)
		}
	case map[string]any:
		if v, ok := value.(map[string]any); ok {
			for key, item := range v {
				d[key] = mergeExtraValue(d[key], item)
			}
			return d
		}
	}
	return value
}

// mergeStreamResponseBody 将流式（SSE）响应原文合并为单个最终响应对象，
// 便于落库后直接阅读模型输出，避免存储大量冗余的分片结构体
// 识别 OpenAI Chat Completions / OpenAI Responses / Claude / Gemini 四类主流格式；
// 未识别格式、解析失败或未产生有效内容时原样返回，保证数据不丢失
func mergeStreamResponseBody(raw string) string {
	payloads := parseSSEDataPayloads(raw)
	if len(payloads) == 0 {
		return raw
	}

	// 逐载荷探测格式：首个可识别的分片决定整条流的合并方式
	for _, payload := range payloads {
		var probe map[string]any
		if common.UnmarshalJsonStr(payload, &probe) != nil {
			continue
		}
		_, isGemini := probe["candidates"]
		_, isOpenAIChat := probe["choices"]
		eventType, _ := probe["type"].(string)
		switch {
		case isGemini:
			if merged, ok := mergeGeminiStream(payloads); ok {
				return merged
			}
			return raw
		case isOpenAIChat:
			if merged, ok := mergeOpenAIChatStream(payloads); ok {
				return merged
			}
			return raw
		case isClaudeStreamEventType(eventType):
			if merged, ok := mergeClaudeStream(payloads); ok {
				return merged
			}
			return raw
		case strings.HasPrefix(eventType, "response."):
			if merged, ok := mergeOpenAIResponsesStream(payloads); ok {
				return merged
			}
			return raw
		}
	}
	return raw
}

// isClaudeStreamEventType 判断 SSE 事件 type 是否为 Claude Messages API 的事件类型
func isClaudeStreamEventType(eventType string) bool {
	switch eventType {
	case "message_start", "content_block_start", "content_block_delta",
		"content_block_stop", "message_delta", "message_stop", "ping", "error":
		return true
	}
	return false
}

// ---------- OpenAI Chat Completions ----------

type openaiStreamChunk struct {
	ID                string               `json:"id"`
	Object            string               `json:"object"`
	Created           int64                `json:"created"`
	Model             string               `json:"model"`
	SystemFingerprint string               `json:"system_fingerprint"`
	ServiceTier       string               `json:"service_tier"`
	Choices           []openaiStreamChoice `json:"choices"`
	Usage             map[string]any       `json:"usage"`
	// Error 保持 any：第三方透传渠道可能发出字符串型错误载荷（{"error":"rate limited"}）
	Error any `json:"error"`
}

type openaiStreamChoice struct {
	Index        int               `json:"index"`
	Delta        openaiStreamDelta `json:"delta"`
	FinishReason *string           `json:"finish_reason"`
}

type openaiStreamDelta struct {
	Role             string                    `json:"role"`
	Content          *string                   `json:"content"`
	ReasoningContent *string                   `json:"reasoning_content"`
	Reasoning        *string                   `json:"reasoning"`
	Refusal          *string                   `json:"refusal"`
	FunctionCall     *openaiStreamFunctionCall `json:"function_call"`
	ToolCalls        []openaiStreamToolCall    `json:"tool_calls"`
	// Audio 音频输出模态（gpt-4o-audio 等）：data/transcript 分片增量下发，需跨分片拼接
	Audio *openaiStreamDeltaAudio `json:"audio"`
}

type openaiStreamDeltaAudio struct {
	ID         string `json:"id"`
	Data       string `json:"data"`
	Transcript string `json:"transcript"`
	ExpiresAt  any    `json:"expires_at"`
}

type openaiStreamFunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type openaiStreamToolCall struct {
	Index    *int                     `json:"index"`
	ID       string                   `json:"id"`
	Type     string                   `json:"type"`
	Function openaiStreamFunctionCall `json:"function"`
}

type openaiToolCallAccumulator struct {
	id        string
	callType  string
	name      string
	arguments strings.Builder
}

type openaiChoiceAccumulator struct {
	role             string
	content          strings.Builder
	reasoningContent strings.Builder
	reasoning        strings.Builder
	refusal          strings.Builder
	functionCall     *openaiStreamFunctionCall
	audioID          string
	audioData        strings.Builder
	audioTranscript  strings.Builder
	audioExpiresAt   any
	toolCalls        map[int]*openaiToolCallAccumulator
	toolCallOrder    []int
	lastImplicitTool int
	finishReason     *string
	// deltaExtra/choiceExtra 收集未建模的业务扩展字段（annotations/logprobs 等），
	// 按 mergeExtraValue 规则合并，落库时不丢失
	deltaExtra  map[string]any
	choiceExtra map[string]any
}

// openaiMergeStream 输出构造：map 形态以支持未知扩展键
type openaiMergeStream map[string]any

// mergeOpenAIChatStream 将 OpenAI Chat Completions 流式分片合并为单个 chat.completion 对象
// 分片中的 delta.content/reasoning/tool_calls 按序拼接，usage 与 finish_reason 取最后一个非空值
func mergeOpenAIChatStream(payloads []string) (string, bool) {
	var base openaiStreamChunk
	choices := map[int]*openaiChoiceAccumulator{}
	var choiceOrder []int
	var usage map[string]any
	var streamError any
	var topExtra map[string]any

	for _, payload := range payloads {
		var chunk openaiStreamChunk
		if !decodeStreamPayload(payload, &chunk) {
			continue
		}
		var raw map[string]any
		if common.UnmarshalJsonStr(payload, &raw) != nil {
			continue
		}
		if base.ID == "" {
			base = chunk
		}
		if len(chunk.Usage) > 0 {
			usage = chunk.Usage
		}
		if chunk.Error != nil {
			streamError = chunk.Error
		}
		for key, value := range raw {
			switch key {
			case "id", "object", "created", "model", "system_fingerprint",
				"service_tier", "choices", "usage", "error":
				continue
			}
			if topExtra == nil {
				topExtra = map[string]any{}
			}
			topExtra[key] = mergeExtraValue(topExtra[key], value)
		}
		for i := range chunk.Choices {
			choice := chunk.Choices[i]
			var choiceRaw, deltaRaw map[string]any
			if rawChoices, ok := raw["choices"].([]any); ok && i < len(rawChoices) {
				choiceRaw, _ = rawChoices[i].(map[string]any)
				if deltaAny, ok := choiceRaw["delta"].(map[string]any); ok {
					deltaRaw = deltaAny
				}
			}
			acc, ok := choices[choice.Index]
			if !ok {
				acc = &openaiChoiceAccumulator{
					toolCalls:   map[int]*openaiToolCallAccumulator{},
					deltaExtra:  map[string]any{},
					choiceExtra: map[string]any{},
				}
				choices[choice.Index] = acc
				choiceOrder = append(choiceOrder, choice.Index)
			}
			acc.append(choice, choiceRaw, deltaRaw)
		}
	}

	if len(choiceOrder) == 0 && usage == nil && streamError == nil {
		return "", false
	}

	merged := openaiMergeStream{
		"id":     base.ID,
		"object": "chat.completion",
	}
	if base.Created != 0 {
		merged["created"] = base.Created
	}
	if base.Model != "" {
		merged["model"] = base.Model
	}
	if base.SystemFingerprint != "" {
		merged["system_fingerprint"] = base.SystemFingerprint
	}
	if base.ServiceTier != "" {
		merged["service_tier"] = base.ServiceTier
	}
	if usage != nil {
		merged["usage"] = usage
	}
	if streamError != nil {
		merged["error"] = streamError
	}
	for key, value := range topExtra {
		merged[key] = value
	}
	mergedChoices := []any{}
	for _, index := range choiceOrder {
		mergedChoices = append(mergedChoices, choices[index].toMergedChoice(index))
	}
	merged["choices"] = mergedChoices

	data, err := common.Marshal(merged)
	if err != nil {
		return "", false
	}
	return string(data), true
}

// modeledOpenAIDeltaKeys delta 上已建模的键：不进入扩展字段收集
var modeledOpenAIDeltaKeys = map[string]struct{}{
	"role": {}, "content": {}, "reasoning_content": {}, "reasoning": {},
	"refusal": {}, "function_call": {}, "tool_calls": {}, "audio": {},
}

func (a *openaiChoiceAccumulator) append(choice openaiStreamChoice, choiceRaw, deltaRaw map[string]any) {
	delta := choice.Delta
	if a.role == "" && delta.Role != "" {
		a.role = delta.Role
	}
	appendOptionalString(&a.content, delta.Content)
	appendOptionalString(&a.reasoningContent, delta.ReasoningContent)
	appendOptionalString(&a.reasoning, delta.Reasoning)
	appendOptionalString(&a.refusal, delta.Refusal)
	if choice.FinishReason != nil && *choice.FinishReason != "" {
		a.finishReason = choice.FinishReason
	}
	if delta.Audio != nil {
		a.audioID = firstNonEmpty(a.audioID, delta.Audio.ID)
		a.audioData.WriteString(delta.Audio.Data)
		a.audioTranscript.WriteString(delta.Audio.Transcript)
		if a.audioExpiresAt == nil {
			a.audioExpiresAt = delta.Audio.ExpiresAt
		}
	}
	if delta.FunctionCall != nil {
		if a.functionCall == nil {
			a.functionCall = &openaiStreamFunctionCall{}
		}
		if a.functionCall.Name == "" {
			a.functionCall.Name = delta.FunctionCall.Name
		}
		a.functionCall.Arguments += delta.FunctionCall.Arguments
	}
	for i, call := range delta.ToolCalls {
		callIndex := 0
		switch {
		case call.Index != nil:
			callIndex = *call.Index
		case len(delta.ToolCalls) > 1:
			// 同一分片携带多个未标 index 的调用：按位置区分
			callIndex = i
		case call.ID != "":
			// 分片缺失 index（部分第三方实现）：带新 id 的分片开启新调用，
			// id 已存在则延续该调用；id 为空视为上一槽位的参数续片
			callIndex = len(a.toolCallOrder)
			for slot, toolAcc := range a.toolCalls {
				if toolAcc.id == call.ID {
					callIndex = slot
					break
				}
			}
		default:
			callIndex = a.lastImplicitTool
		}
		a.lastImplicitTool = callIndex
		toolAcc, ok := a.toolCalls[callIndex]
		if !ok {
			toolAcc = &openaiToolCallAccumulator{}
			a.toolCalls[callIndex] = toolAcc
			a.toolCallOrder = append(a.toolCallOrder, callIndex)
		}
		toolAcc.id = firstNonEmpty(toolAcc.id, call.ID)
		toolAcc.callType = firstNonEmpty(toolAcc.callType, call.Type)
		toolAcc.name = firstNonEmpty(toolAcc.name, call.Function.Name)
		toolAcc.arguments.WriteString(call.Function.Arguments)
	}
	for key, value := range deltaRaw {
		if _, ok := modeledOpenAIDeltaKeys[key]; ok {
			continue
		}
		a.deltaExtra[key] = mergeExtraValue(a.deltaExtra[key], value)
	}
	for key, value := range choiceRaw {
		switch key {
		case "index", "delta", "finish_reason":
			continue
		}
		a.choiceExtra[key] = mergeExtraValue(a.choiceExtra[key], value)
	}
}

func (a *openaiChoiceAccumulator) toMergedChoice(index int) map[string]any {
	message := map[string]any{"role": firstNonEmpty(a.role, "assistant")}
	if content := a.content.String(); content != "" {
		message["content"] = content
	}
	if reasoning := a.reasoningContent.String(); reasoning != "" {
		message["reasoning_content"] = reasoning
	}
	if reasoning := a.reasoning.String(); reasoning != "" {
		message["reasoning"] = reasoning
	}
	if refusal := a.refusal.String(); refusal != "" {
		message["refusal"] = refusal
	}
	if a.audioID != "" || a.audioData.Len() > 0 || a.audioTranscript.Len() > 0 || a.audioExpiresAt != nil {
		audio := map[string]any{}
		if a.audioID != "" {
			audio["id"] = a.audioID
		}
		if data := a.audioData.String(); data != "" {
			audio["data"] = data
		}
		if transcript := a.audioTranscript.String(); transcript != "" {
			audio["transcript"] = transcript
		}
		if a.audioExpiresAt != nil {
			audio["expires_at"] = a.audioExpiresAt
		}
		message["audio"] = audio
	}
	if len(a.toolCallOrder) > 0 {
		toolCalls := []any{}
		for _, callIndex := range a.toolCallOrder {
			toolAcc := a.toolCalls[callIndex]
			toolCalls = append(toolCalls, map[string]any{
				"id":   toolAcc.id,
				"type": firstNonEmpty(toolAcc.callType, "function"),
				"function": map[string]any{
					"name":      toolAcc.name,
					"arguments": toolAcc.arguments.String(),
				},
			})
		}
		message["tool_calls"] = toolCalls
	}
	if a.functionCall != nil {
		message["function_call"] = a.functionCall
	}
	for key, value := range a.deltaExtra {
		message[key] = value
	}

	choiceMap := map[string]any{"index": index, "message": message, "finish_reason": a.finishReason}
	for key, value := range a.choiceExtra {
		choiceMap[key] = value
	}
	return choiceMap
}

// appendOptionalString 追加可选字符串：指针为 nil（字段缺失/null）时不拼接
func appendOptionalString(builder *strings.Builder, value *string) {
	if value != nil {
		builder.WriteString(*value)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// ---------- Claude (Anthropic Messages) ----------

type claudeStreamEvent struct {
	Type         string              `json:"type"`
	Message      *claudeMessageStart `json:"message"`
	Index        int                 `json:"index"`
	ContentBlock map[string]any      `json:"content_block"`
	Delta        *claudeStreamDelta  `json:"delta"`
	Usage        map[string]any      `json:"usage"`
	// Error 保持 any：错误载荷可能是对象（官方）或字符串（第三方透传）
	Error any `json:"error"`
}

type claudeMessageStart struct {
	ID    string         `json:"id"`
	Model string         `json:"model"`
	Role  string         `json:"role"`
	Usage map[string]any `json:"usage"`
}

type claudeStreamDelta struct {
	Type         string          `json:"type"`
	Text         string          `json:"text"`
	Thinking     string          `json:"thinking"`
	Signature    string          `json:"signature"`
	PartialJson  string          `json:"partial_json"`
	Citation     json.RawMessage `json:"citation"`
	StopReason   *string         `json:"stop_reason"`
	StopSequence *string         `json:"stop_sequence"`
}

type claudeBlockAccumulator struct {
	startBlock  map[string]any
	text        strings.Builder
	thinking    strings.Builder
	signature   strings.Builder
	partialJSON strings.Builder
	citations   []any
}

// mergeClaudeStream 将 Claude Messages 流式事件合并为单个 message 对象
// content_block_delta 按块索引累积（text_delta/thinking_delta/input_json_delta/citations_delta 等），
// 块对象基于 content_block_start 原样保留未知字段后叠加累积内容，
// input 的 partial_json 在流结束时解析为对象；usage 以 message_start 为基线、message_delta 覆盖
func mergeClaudeStream(payloads []string) (string, bool) {
	var start *claudeMessageStart
	blocks := map[int]*claudeBlockAccumulator{}
	var blockOrder []int
	usage := map[string]any{}
	hasUsage := false
	var stopReason, stopSequence *string
	var streamError any

	for _, payload := range payloads {
		var event claudeStreamEvent
		if !decodeStreamPayload(payload, &event) {
			continue
		}
		switch event.Type {
		case "message_start":
			if event.Message != nil {
				start = event.Message
				for key, value := range event.Message.Usage {
					usage[key] = value
					hasUsage = true
				}
			}
		case "content_block_start":
			blocks[event.Index] = &claudeBlockAccumulator{startBlock: event.ContentBlock}
			tracked := false
			for _, existing := range blockOrder {
				if existing == event.Index {
					tracked = true
					break
				}
			}
			if !tracked {
				blockOrder = append(blockOrder, event.Index)
			}
		case "content_block_delta":
			acc, ok := blocks[event.Index]
			if !ok || event.Delta == nil {
				continue
			}
			switch event.Delta.Type {
			case "text_delta":
				acc.text.WriteString(event.Delta.Text)
			case "thinking_delta":
				acc.thinking.WriteString(event.Delta.Thinking)
			case "signature_delta":
				acc.signature.WriteString(event.Delta.Signature)
			case "input_json_delta":
				acc.partialJSON.WriteString(event.Delta.PartialJson)
			case "citations_delta":
				var citation any
				if common.Unmarshal(event.Delta.Citation, &citation) == nil && citation != nil {
					acc.citations = append(acc.citations, citation)
				}
			default:
				if event.Delta.Text != "" {
					acc.text.WriteString(event.Delta.Text)
				}
			}
		case "message_delta":
			if event.Delta != nil {
				if event.Delta.StopReason != nil {
					stopReason = event.Delta.StopReason
				}
				if event.Delta.StopSequence != nil {
					stopSequence = event.Delta.StopSequence
				}
			}
			for key, value := range event.Usage {
				usage[key] = value
				hasUsage = true
			}
		case "error":
			if event.Error != nil {
				streamError = event.Error
			}
		}
	}
	// content_block_stop 与 message_stop 无需处理：块内容在流结束时统一定稿

	var content []any
	for _, index := range blockOrder {
		content = append(content, finalizeClaudeBlock(blocks[index]))
	}

	if start == nil && len(content) == 0 && !hasUsage {
		// 纯错误流（无 message_start）：只保留错误信息
		if streamError == nil {
			return "", false
		}
		merged := map[string]any{"type": "error", "error": streamError}
		data, err := common.Marshal(merged)
		if err != nil {
			return "", false
		}
		return string(data), true
	}

	if content == nil {
		content = []any{}
	}
	merged := map[string]any{"type": "message", "content": content}
	if start != nil {
		merged["id"] = start.ID
		merged["model"] = start.Model
		merged["role"] = firstNonEmpty(start.Role, "assistant")
	}
	if stopReason != nil {
		merged["stop_reason"] = *stopReason
	} else {
		merged["stop_reason"] = nil
	}
	if stopSequence != nil {
		merged["stop_sequence"] = *stopSequence
	} else {
		merged["stop_sequence"] = nil
	}
	if hasUsage {
		merged["usage"] = usage
	}
	if streamError != nil {
		merged["error"] = streamError
	}
	data, err := common.Marshal(merged)
	if err != nil {
		return "", false
	}
	return string(data), true
}

// finalizeClaudeBlock 将一个 content block 的累积内容定稿为最终对象：
// 以 content_block_start 的原始字段为基础（保留未知字段），叠加流式累积的文本/思考/引用/JSON input
func finalizeClaudeBlock(acc *claudeBlockAccumulator) map[string]any {
	block := map[string]any{}
	for key, value := range acc.startBlock {
		block[key] = value
	}
	if text := acc.text.String(); text != "" {
		block["text"] = text
	}
	if thinking := acc.thinking.String(); thinking != "" {
		block["thinking"] = thinking
	}
	if signature := acc.signature.String(); signature != "" {
		block["signature"] = signature
	}
	if len(acc.citations) > 0 {
		// 与 content_block_start 自带的 citations 数组（通常为空数组）合并
		citations := []any{}
		if existing, ok := block["citations"].([]any); ok {
			citations = append(citations, existing...)
		}
		block["citations"] = append(citations, acc.citations...)
	}
	if acc.partialJSON.Len() > 0 {
		var input any
		if common.UnmarshalJsonStr(acc.partialJSON.String(), &input) == nil && input != nil {
			block["input"] = input
		} else {
			// 中断导致 partial_json 截断无法解析：以原文保留，避免参数静默丢失
			block["input_raw"] = acc.partialJSON.String()
		}
	}
	return block
}

// ---------- OpenAI Responses ----------

// mergeOpenAIResponsesStream 提取 OpenAI Responses 流的终态事件
// response.completed / response.incomplete / response.failed 事件携带完整 response 对象，
// 直接作为合并结果；未收到终态事件（中断流）时放弃合并，交由调用方回退原始报文
func mergeOpenAIResponsesStream(payloads []string) (string, bool) {
	var response any
	found := false
	for _, payload := range payloads {
		var event struct {
			Type     string `json:"type"`
			Response any    `json:"response"`
		}
		if !decodeStreamPayload(payload, &event) {
			continue
		}
		switch event.Type {
		case "response.completed", "response.incomplete", "response.failed":
			if event.Response != nil {
				response = event.Response
				found = true
			}
		}
	}
	if !found {
		return "", false
	}
	data, err := common.Marshal(response)
	if err != nil {
		return "", false
	}
	return string(data), true
}

// ---------- Gemini ----------

// geminiPartAccumulator 按出现顺序记录 part：相邻同类 text part 合并到一个槽位
type geminiPartAccumulator struct {
	thought bool
	text    strings.Builder
	raw     map[string]any // 非文本或携带额外字段的 part 原样保留
}

type geminiCandidateAccumulator struct {
	index        int
	role         string
	parts        []geminiPartAccumulator
	extra        map[string]any // candidate 级未拆分字段（grounding/safetyRatings 等），取末值
	finishReason string
}

// mergeGeminiStream 将 Gemini 流式分片合并为单个 GenerateContentResponse
// candidates 按 index 归并：同类型相邻 text 分片拼接（thought 与正文分开）且不改变 part 顺序，
// functionCall 等非文本 part 原样保留；usageMetadata/finishReason 取最后一个非空值
func mergeGeminiStream(payloads []string) (string, bool) {
	candidates := map[int]*geminiCandidateAccumulator{}
	var candidateOrder []int
	var usageMetadata, promptFeedback map[string]any
	modelVersion := ""

	for _, payload := range payloads {
		var chunk struct {
			Candidates     []map[string]any `json:"candidates"`
			UsageMetadata  map[string]any   `json:"usageMetadata"`
			PromptFeedback map[string]any   `json:"promptFeedback"`
			ModelVersion   string           `json:"modelVersion"`
		}
		if !decodeStreamPayload(payload, &chunk) {
			continue
		}
		if modelVersion == "" {
			modelVersion = chunk.ModelVersion
		}
		if len(chunk.UsageMetadata) > 0 {
			usageMetadata = chunk.UsageMetadata
		}
		if len(chunk.PromptFeedback) > 0 {
			promptFeedback = chunk.PromptFeedback
		}
		for position, candidate := range chunk.Candidates {
			index := position
			if rawIndex, ok := candidate["index"].(float64); ok {
				index = int(rawIndex)
			}
			acc, ok := candidates[index]
			if !ok {
				acc = &geminiCandidateAccumulator{index: index, extra: map[string]any{}}
				candidates[index] = acc
				candidateOrder = append(candidateOrder, index)
			}
			acc.append(candidate)
		}
	}

	if len(candidateOrder) == 0 && usageMetadata == nil && promptFeedback == nil {
		return "", false
	}

	merged := map[string]any{}
	if len(candidateOrder) > 0 {
		var mergedCandidates []any
		for _, index := range candidateOrder {
			mergedCandidates = append(mergedCandidates, candidates[index].toMergedCandidate())
		}
		merged["candidates"] = mergedCandidates
	}
	if modelVersion != "" {
		merged["modelVersion"] = modelVersion
	}
	if usageMetadata != nil {
		merged["usageMetadata"] = usageMetadata
	}
	if promptFeedback != nil {
		merged["promptFeedback"] = promptFeedback
	}
	data, err := common.Marshal(merged)
	if err != nil {
		return "", false
	}
	return string(data), true
}

func (acc *geminiCandidateAccumulator) append(candidate map[string]any) {
	content, ok := candidate["content"].(map[string]any)
	if !ok {
		if reason, ok := candidate["finishReason"].(string); ok && reason != "" {
			acc.finishReason = reason
		}
	} else {
		if role, ok := content["role"].(string); ok && role != "" {
			acc.role = role
		}
		if parts, ok := content["parts"].([]any); ok {
			for _, rawPart := range parts {
				part, ok := rawPart.(map[string]any)
				if !ok {
					continue
				}
				text, hasText := part["text"].(string)
				thought, _ := part["thought"].(bool)
				switch {
				case hasText && thought && len(part) == 2:
					acc.appendText(text, true)
				case hasText && !thought && len(part) == 1:
					acc.appendText(text, false)
				default:
					// 携带 thoughtSignature 等额外字段的 part 与非文本 part 原样保留
					acc.parts = append(acc.parts, geminiPartAccumulator{raw: part})
				}
			}
		}
	}
	for key, value := range candidate {
		switch key {
		case "index", "content", "finishReason":
			continue
		}
		acc.extra[key] = value
	}
	if reason, ok := candidate["finishReason"].(string); ok && reason != "" {
		acc.finishReason = reason
	}
}

// appendText 将纯 text 分片合并到相邻同类槽位：与上一槽位同类型则拼接，否则新开槽位
func (acc *geminiCandidateAccumulator) appendText(text string, thought bool) {
	if n := len(acc.parts); n > 0 {
		last := &acc.parts[n-1]
		if last.raw == nil && last.thought == thought {
			last.text.WriteString(text)
			return
		}
	}
	acc.parts = append(acc.parts, geminiPartAccumulator{thought: thought})
	acc.parts[len(acc.parts)-1].text.WriteString(text)
}

func (acc *geminiCandidateAccumulator) toMergedCandidate() map[string]any {
	candidate := map[string]any{"index": acc.index}
	parts := []any{}
	for _, part := range acc.parts {
		if part.raw != nil {
			parts = append(parts, part.raw)
			continue
		}
		entry := map[string]any{"text": part.text.String()}
		if part.thought {
			entry["thought"] = true
		}
		parts = append(parts, entry)
	}
	if len(parts) > 0 {
		content := map[string]any{"parts": parts}
		if acc.role != "" {
			content["role"] = acc.role
		}
		candidate["content"] = content
	}
	if acc.finishReason != "" {
		candidate["finishReason"] = acc.finishReason
	}
	for key, value := range acc.extra {
		candidate[key] = value
	}
	return candidate
}
