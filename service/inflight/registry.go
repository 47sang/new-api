package inflight

import (
	"net/http"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

// Phase 表示一条在途请求当前所处的阶段。
// 用字符串而不是 int 枚举，让 JSON 直接输出 queued / active，前端无需再做数值映射。
type Phase string

const (
	// PhaseQueued 已进入 relay，但请求还没发往上游（选路 / 预扣 / 重试退避）。
	PhaseQueued Phase = "queued"
	// PhaseActive 请求已发往上游，正在等待响应。
	PhaseActive Phase = "active"
)

// Record 是一条在途请求的快照。
type Record struct {
	Id                    string `json:"id"`
	Model                 string `json:"model"`
	Username              string `json:"username"`
	TokenName             string `json:"token_name"`
	ChannelId             int    `json:"channel_id"`
	ChannelName           string `json:"channel_name"`
	StartTime             int64  `json:"start_time"`
	EstimatedPromptTokens int    `json:"estimated_prompt_tokens"`
	Phase                 Phase  `json:"phase"`
}

// Snapshot 是推送给前端的一帧全量数据。
type Snapshot struct {
	Inflight                []Record       `json:"inflight"`
	Peaks                   map[string]int `json:"peaks"`
	TotalInflight           int            `json:"total_inflight"`
	TotalEstimatedTokens    int            `json:"total_estimated_prompt_tokens"`
	TotalEstimatedTokenNote string         `json:"total_estimated_token_note,omitempty"`
}

// maxTrackedInflight 是在途登记表的上限。正常部署的在途请求远小于此值；
// 上限用于兜底，避免异常路径下内存无限制增长。超出后新请求不再登记，
// 但 Begin 仍返回可安全使用的 Record（MarkActive / Finish 对 nil 与未登记记录都是空操作）。
const maxTrackedInflight = 5000

type registry struct {
	mu       sync.RWMutex
	inflight map[string]*Record
	// counts 维护每个模型当前在途数，peaks 维护每个模型的并发上限估计：
	// 取观测到的最大并发，撞上游 429 时收紧（只紧不放）。
	counts map[string]int
	peaks  map[string]int
}

var defaultRegistry = &registry{
	inflight: make(map[string]*Record),
	counts:   make(map[string]int),
	peaks:    make(map[string]int),
}

// Begin 登记一条在途请求。应在 GenRelayInfo 成功之后调用，此时才能拿到模型名。
// 返回的 Record 由调用方交给 MarkActive / Finish，无需判空。
func Begin(c *gin.Context, info *relaycommon.RelayInfo) *Record {
	if c == nil || info == nil {
		return nil
	}
	id := c.GetString(common.RequestIdKey)
	if id == "" {
		id = common.NewRequestId()
	}
	record := &Record{
		Id:                    id,
		Model:                 info.OriginModelName,
		Username:              c.GetString(string(constant.ContextKeyUserName)),
		TokenName:             c.GetString("token_name"),
		StartTime:             common.GetTimestamp(),
		EstimatedPromptTokens: info.GetEstimatePromptTokens(),
		Phase:                 PhaseQueued,
	}

	defaultRegistry.mu.Lock()
	defer defaultRegistry.mu.Unlock()
	if len(defaultRegistry.inflight) >= maxTrackedInflight {
		return record
	}
	defaultRegistry.inflight[id] = record
	defaultRegistry.addLocked(record.Model)
	return record
}

// MarkActive 把记录切到「已发往上游」，并补上渠道信息（选路完成后才有）
// 与预计输入 token（预扣费算完后才有，Begin 时还拿不到）。
func MarkActive(record *Record, c *gin.Context, info *relaycommon.RelayInfo) {
	if record == nil || c == nil {
		return
	}
	defaultRegistry.mu.Lock()
	defer defaultRegistry.mu.Unlock()
	if _, ok := defaultRegistry.inflight[record.Id]; !ok {
		return
	}
	record.Phase = PhaseActive
	record.ChannelId = c.GetInt(string(constant.ContextKeyChannelId))
	record.ChannelName = c.GetString(string(constant.ContextKeyChannelName))
	if info != nil {
		record.EstimatedPromptTokens = info.GetEstimatePromptTokens()
	}
}

// Finish 注销一条在途请求，并在收到上游 429 时收紧该模型的并发上限。
// apiErr 指向 relay 的错误变量：网关自身的限流在中间件层就挡下了，根本进不到 relay，
// 因此这里见到的 429 必然是上游 / 渠道返回的，无需再区分来源。
func Finish(record *Record, apiErr **types.NewAPIError) {
	if record == nil {
		return
	}
	defaultRegistry.mu.Lock()
	defer defaultRegistry.mu.Unlock()
	// 未登记的记录（超出容量上限被丢弃的那类）不在在途表里，没有可引用的并发现场，
	// 既不该抬峰也不该收紧，直接放过。
	if _, ok := defaultRegistry.inflight[record.Id]; !ok {
		return
	}
	// 先收紧上限再注销：此刻记录仍在表中，在途数含本次请求，
	// 减一才是「撞 429 当时仍在被上游服务的请求数」。
	if isUpstreamTooManyRequests(apiErr) {
		defaultRegistry.tightenPeakLocked(record.Model)
	}
	delete(defaultRegistry.inflight, record.Id)
	if count := defaultRegistry.counts[record.Model]; count > 1 {
		defaultRegistry.counts[record.Model] = count - 1
	} else {
		delete(defaultRegistry.counts, record.Model)
	}
}

// TakeSnapshot 生成一帧全量数据，供 SSE 端点与测试使用。
func TakeSnapshot() Snapshot {
	defaultRegistry.mu.RLock()
	defer defaultRegistry.mu.RUnlock()

	inflight := make([]Record, 0, len(defaultRegistry.inflight))
	totalEstimated := 0
	for _, record := range defaultRegistry.inflight {
		inflight = append(inflight, *record)
		totalEstimated += record.EstimatedPromptTokens
	}
	peaks := make(map[string]int, len(defaultRegistry.peaks))
	for model, peak := range defaultRegistry.peaks {
		peaks[model] = peak
	}
	return Snapshot{
		Inflight:             inflight,
		Peaks:                peaks,
		TotalInflight:        len(inflight),
		TotalEstimatedTokens: totalEstimated,
	}
}

// addLocked 登记后维护计数并刷新峰值：实际并发升高同样会抬高峰值。
func (r *registry) addLocked(model string) {
	if model == "" {
		return
	}
	r.counts[model]++
	if r.counts[model] > r.peaks[model] {
		r.peaks[model] = r.counts[model]
	}
}

// tightenPeakLocked 用「撞 429 时仍在被上游服务的请求数」收紧该模型的并发上限。
// 被 429 拒掉的这条本身不占上游并发，故在途数减一；结果不低于 1——单条请求被拒时
// 并没有「并发被打满」的证据，保留 1 只是不让该模型那一节从面板上消失。
// 上限只紧不放：被 429 证伪的水位会被淘汰，但已经取到的更紧上界不会被虚高的在途数顶掉。
func (r *registry) tightenPeakLocked(model string) {
	if model == "" {
		return
	}
	served := max(r.counts[model]-1, 1)
	if served < r.peaks[model] {
		r.peaks[model] = served
	}
}

func isUpstreamTooManyRequests(apiErr **types.NewAPIError) bool {
	if apiErr == nil || *apiErr == nil {
		return false
	}
	return (*apiErr).StatusCode == http.StatusTooManyRequests
}
