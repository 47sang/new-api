package middleware

import (
	"bufio"
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
	return payloads
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
	Error             map[string]any       `json:"error"`
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
	toolCalls        map[int]*openaiToolCallAccumulator
	toolCallOrder    []int
	finishReason     *string
}

// mergeOpenAIChatStream 将 OpenAI Chat Completions 流式分片合并为单个 chat.completion 对象
// 分片中的 delta.content/reasoning/tool_calls 按序拼接，usage 与 finish_reason 取最后一个非空值
func mergeOpenAIChatStream(payloads []string) (string, bool) {
	var base openaiStreamChunk
	choices := map[int]*openaiChoiceAccumulator{}
	var choiceOrder []int
	var usage map[string]any
	var streamError map[string]any

	for _, payload := range payloads {
		var chunk openaiStreamChunk
		if common.UnmarshalJsonStr(payload, &chunk) != nil {
			continue
		}
		if base.ID == "" {
			base = chunk
		}
		if len(chunk.Usage) > 0 {
			usage = chunk.Usage
		}
		if len(chunk.Error) > 0 {
			streamError = chunk.Error
		}
		for _, choice := range chunk.Choices {
			acc, ok := choices[choice.Index]
			if !ok {
				acc = &openaiChoiceAccumulator{toolCalls: map[int]*openaiToolCallAccumulator{}}
				choices[choice.Index] = acc
				choiceOrder = append(choiceOrder, choice.Index)
			}
			acc.append(choice)
		}
	}

	if len(choiceOrder) == 0 && usage == nil && streamError == nil {
		return "", false
	}

	merged := openaiMergedResponse{
		ID:                base.ID,
		Object:            "chat.completion",
		Created:           base.Created,
		Model:             base.Model,
		SystemFingerprint: base.SystemFingerprint,
		ServiceTier:       base.ServiceTier,
		Choices:           []openaiMergedChoice{},
		Usage:             usage,
		Error:             streamError,
	}
	for _, index := range choiceOrder {
		merged.Choices = append(merged.Choices, choices[index].toMergedChoice(index))
	}
	data, err := common.Marshal(merged)
	if err != nil {
		return "", false
	}
	return string(data), true
}

func (a *openaiChoiceAccumulator) append(choice openaiStreamChoice) {
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
		if call.Index != nil {
			callIndex = *call.Index
		} else if len(delta.ToolCalls) > 1 {
			callIndex = i
		}
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
}

func (a *openaiChoiceAccumulator) toMergedChoice(index int) openaiMergedChoice {
	message := openaiMergedMessage{Role: firstNonEmpty(a.role, "assistant")}
	message.Content = a.content.String()
	message.ReasoningContent = a.reasoningContent.String()
	message.Reasoning = a.reasoning.String()
	message.Refusal = a.refusal.String()
	for _, callIndex := range a.toolCallOrder {
		toolAcc := a.toolCalls[callIndex]
		message.ToolCalls = append(message.ToolCalls, openaiMergedToolCall{
			ID:       toolAcc.id,
			Type:     firstNonEmpty(toolAcc.callType, "function"),
			Function: openaiStreamFunctionCall{Name: toolAcc.name, Arguments: toolAcc.arguments.String()},
		})
	}
	message.FunctionCall = a.functionCall
	return openaiMergedChoice{Index: index, Message: message, FinishReason: a.finishReason}
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

type openaiMergedResponse struct {
	ID                string               `json:"id"`
	Object            string               `json:"object"`
	Created           int64                `json:"created"`
	Model             string               `json:"model"`
	SystemFingerprint string               `json:"system_fingerprint,omitempty"`
	ServiceTier       string               `json:"service_tier,omitempty"`
	Choices           []openaiMergedChoice `json:"choices"`
	Usage             map[string]any       `json:"usage,omitempty"`
	Error             map[string]any       `json:"error,omitempty"`
}

type openaiMergedChoice struct {
	Index        int                 `json:"index"`
	Message      openaiMergedMessage `json:"message"`
	FinishReason *string             `json:"finish_reason"`
}

type openaiMergedMessage struct {
	Role             string                    `json:"role"`
	Content          string                    `json:"content,omitempty"`
	ReasoningContent string                    `json:"reasoning_content,omitempty"`
	Reasoning        string                    `json:"reasoning,omitempty"`
	Refusal          string                    `json:"refusal,omitempty"`
	ToolCalls        []openaiMergedToolCall    `json:"tool_calls,omitempty"`
	FunctionCall     *openaiStreamFunctionCall `json:"function_call,omitempty"`
}

type openaiMergedToolCall struct {
	ID       string                   `json:"id,omitempty"`
	Type     string                   `json:"type,omitempty"`
	Function openaiStreamFunctionCall `json:"function"`
}

// ---------- Claude (Anthropic Messages) ----------

type claudeStreamEvent struct {
	Type         string              `json:"type"`
	Message      *claudeMessageStart `json:"message"`
	Index        int                 `json:"index"`
	ContentBlock map[string]any      `json:"content_block"`
	Delta        *claudeStreamDelta  `json:"delta"`
	Usage        map[string]any      `json:"usage"`
	Error        map[string]any      `json:"error"`
}

type claudeMessageStart struct {
	ID    string         `json:"id"`
	Model string         `json:"model"`
	Role  string         `json:"role"`
	Usage map[string]any `json:"usage"`
}

type claudeStreamDelta struct {
	Type         string  `json:"type"`
	Text         string  `json:"text"`
	Thinking     string  `json:"thinking"`
	Signature    string  `json:"signature"`
	PartialJson  string  `json:"partial_json"`
	StopReason   *string `json:"stop_reason"`
	StopSequence *string `json:"stop_sequence"`
}

type claudeBlockAccumulator struct {
	startBlock  map[string]any
	text        strings.Builder
	thinking    strings.Builder
	signature   strings.Builder
	partialJSON strings.Builder
}

// mergeClaudeStream 将 Claude Messages 流式事件合并为单个 message 对象
// content_block_delta 按块索引累积（text_delta/thinking_delta/input_json_delta 等），
// 块对象基于 content_block_start 原样保留未知字段后叠加累积内容，
// input 的 partial_json 在流结束时解析为对象；usage 以 message_start 为基线、message_delta 覆盖
func mergeClaudeStream(payloads []string) (string, bool) {
	var start *claudeMessageStart
	blocks := map[int]*claudeBlockAccumulator{}
	var blockOrder []int
	usage := map[string]any{}
	hasUsage := false
	var stopReason, stopSequence *string
	var streamError map[string]any

	for _, payload := range payloads {
		var event claudeStreamEvent
		if common.UnmarshalJsonStr(payload, &event) != nil {
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
			if len(event.Error) > 0 {
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
	merged := claudeMergedResponse{
		Type:         "message",
		Content:      content,
		StopReason:   stopReason,
		StopSequence: stopSequence,
		Usage:        usage,
		Error:        streamError,
	}
	if start != nil {
		merged.ID = start.ID
		merged.Model = start.Model
		merged.Role = firstNonEmpty(start.Role, "assistant")
	}
	data, err := common.Marshal(merged)
	if err != nil {
		return "", false
	}
	return string(data), true
}

// finalizeClaudeBlock 将一个 content block 的累积内容定稿为最终对象：
// 以 content_block_start 的原始字段为基础（保留未知字段），叠加流式累积的文本/思考/JSON input
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
	if acc.partialJSON.Len() > 0 {
		var input any
		if common.UnmarshalJsonStr(acc.partialJSON.String(), &input) == nil && input != nil {
			block["input"] = input
		}
	}
	return block
}

type claudeMergedResponse struct {
	ID           string         `json:"id"`
	Type         string         `json:"type"`
	Role         string         `json:"role"`
	Model        string         `json:"model"`
	Content      []any          `json:"content"`
	StopReason   *string        `json:"stop_reason"`
	StopSequence *string        `json:"stop_sequence"`
	Usage        map[string]any `json:"usage,omitempty"`
	Error        map[string]any `json:"error,omitempty"`
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
		if common.UnmarshalJsonStr(payload, &event) != nil {
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

type geminiCandidateAccumulator struct {
	index        int
	role         string
	text         strings.Builder
	thoughtText  strings.Builder
	parts        []map[string]any
	finishReason string
}

// mergeGeminiStream 将 Gemini 流式分片合并为单个 GenerateContentResponse
// candidates 按 index 归并：纯 text 分片拼接（thought 分片单独拼接），
// 带 thoughtSignature 等额外字段的 part 与 functionCall 等非文本 part 原样保留；
// usageMetadata/finishReason 取最后一个非空值
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
		if common.UnmarshalJsonStr(payload, &chunk) != nil {
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
				acc = &geminiCandidateAccumulator{index: index}
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
		return
	}
	if role, ok := content["role"].(string); ok && role != "" {
		acc.role = role
	}
	parts, ok := content["parts"].([]any)
	if !ok {
		return
	}
	for _, rawPart := range parts {
		part, ok := rawPart.(map[string]any)
		if !ok {
			continue
		}
		text, hasText := part["text"].(string)
		if !hasText {
			acc.parts = append(acc.parts, part)
			continue
		}
		// 纯 text / text+thought 的分片拼接合并；携带 thoughtSignature 等额外字段的原样保留
		thought, _ := part["thought"].(bool)
		switch len(part) {
		case 1:
			acc.text.WriteString(text)
		case 2:
			if thought {
				acc.thoughtText.WriteString(text)
			} else {
				acc.parts = append(acc.parts, part)
			}
		default:
			acc.parts = append(acc.parts, part)
		}
	}
	if reason, ok := candidate["finishReason"].(string); ok && reason != "" {
		acc.finishReason = reason
	}
}

func (acc *geminiCandidateAccumulator) toMergedCandidate() map[string]any {
	candidate := map[string]any{"index": acc.index}
	parts := []any{}
	if text := acc.text.String(); text != "" {
		parts = append(parts, map[string]any{"text": text})
	}
	if thought := acc.thoughtText.String(); thought != "" {
		parts = append(parts, map[string]any{"text": thought, "thought": true})
	}
	for _, part := range acc.parts {
		parts = append(parts, part)
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
	return candidate
}
