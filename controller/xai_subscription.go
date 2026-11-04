package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

// xAI 订阅（设备码登录）的四个端点。登录态在服务端进程内，界面轮询 status 拿进度，
// 因此刷新页面、重开抽屉都不丢进度。响应里不出现访问令牌与设备码；失败只回类别与错误码，
// 文案由前端按类别做国际化。

// StartXaiSubscriptionLogin 开始一次设备码登录。
func StartXaiSubscriptionLogin(c *gin.Context) {
	challenge, sessionID, err := service.XaiStartDeviceLogin()
	if err != nil {
		writeXaiLoginError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"session_id":       sessionID,
			"user_code":        challenge.UserCode,
			"verification_uri": challenge.VerificationURI,
			"expires_in":       challenge.ExpiresInSec,
		},
	})
}

// GetXaiSubscriptionLoginStatus 轮询一次登录进度。
func GetXaiSubscriptionLoginStatus(c *gin.Context) {
	sessionID := strings.TrimSpace(c.Query("session_id"))
	if sessionID == "" {
		common.ApiErrorMsg(c, "session_id is required")
		return
	}
	result, err := service.XaiPollDeviceLogin(sessionID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	data := gin.H{
		"status":     result.Status,
		"remain_sec": result.RemainSec,
	}
	switch result.Status {
	case "success":
		// 登录成功：把订阅会话交给我界面填进密钥字段（仅此一次，之后只存脱敏状态）
		encoded, marshalErr := common.Marshal(result.Key)
		if marshalErr != nil {
			common.ApiError(c, marshalErr)
			return
		}
		data["key"] = string(encoded)
		data["email"] = result.Key.Email
	case "failed":
		if result.Failure != nil {
			data["reason"] = result.Failure.Reason
			data["code"] = result.Failure.Code
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    data,
	})
}

// CancelXaiSubscriptionLogin 放弃一次登录。
func CancelXaiSubscriptionLogin(c *gin.Context) {
	sessionID := strings.TrimSpace(c.Query("session_id"))
	if sessionID == "" {
		common.ApiErrorMsg(c, "session_id is required")
		return
	}
	service.XaiCancelDeviceLogin(sessionID)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// SignOutXaiSubscription 退出登录：只清这台网关上的令牌，渠道与模型保留。
// 走显式的单列更新——UpdateChannel 对空 key 会因零值被 GORM 忽略，清不掉。
func SignOutXaiSubscription(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ch, err := model.GetChannelById(channelID, true)
	if err != nil || ch == nil {
		common.ApiErrorT(c, "Channel not found")
		return
	}
	if ch.Type != constant.ChannelTypeXaiSub {
		common.ApiErrorMsg(c, "channel is not an xAI subscription channel")
		return
	}
	if err := model.DB.Model(&model.Channel{}).Where("id = ?", ch.Id).Update("key", "").Error; err != nil {
		common.ApiError(c, err)
		return
	}
	model.InitChannelCache()
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// GetXaiSubscriptionChannelStatus 读一个订阅渠道的登录态。加载渠道详情时后端不返回 key
// （Omit("key")），编辑表单靠这个接口判断「已登录」，不回传令牌本身。
func GetXaiSubscriptionChannelStatus(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ch, err := model.GetChannelById(channelID, true)
	if err != nil || ch == nil {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "",
			"data":    gin.H{"signed_in": false},
		})
		return
	}
	if ch.Type != constant.ChannelTypeXaiSub {
		common.ApiErrorMsg(c, "channel is not an xAI subscription channel")
		return
	}
	key, parseErr := service.ParseXaiOAuthKey(strings.TrimSpace(ch.Key))
	if parseErr != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "",
			"data":    gin.H{"signed_in": false},
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"signed_in":   true,
			"email":       key.Email,
			"expires_at":  key.ExpiresAt,
			"refreshable": strings.TrimSpace(key.RefreshToken) != "",
		},
	})
}

// GetXaiCurrentSubscriptionLogin 查当前进行中的登录，供界面重开后恢复进度。
func GetXaiCurrentSubscriptionLogin(c *gin.Context) {
	challenge, sessionID, active := service.XaiCurrentDeviceLogin()
	if !active {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "",
			"data":    gin.H{"active": false},
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"active":           true,
			"session_id":       sessionID,
			"user_code":        challenge.UserCode,
			"verification_uri": challenge.VerificationURI,
			"remain_sec":       challenge.ExpiresInSec,
		},
	})
}

// RefreshXaiSubscriptionCredential 手动刷新一个订阅渠道的凭证。
func RefreshXaiSubscriptionCredential(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	key, ch, err := service.RefreshXaiChannelCredential(c.Request.Context(), channelID, true)
	if err != nil {
		common.SysError(common.LogText("failed to refresh xai subscription credential: %s", err.Error()))
		common.ApiErrorT(c, "Failed to refresh credentials. Please try again later")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "refreshed",
		"data": gin.H{
			"expires_at":   key.ExpiresAt,
			"last_refresh": key.LastRefresh,
			"email":        key.Email,
			"channel_id":   ch.Id,
			"channel_type": ch.Type,
			"channel_name": ch.Name,
		},
	})
}

// writeXaiLoginError 把登录失败写成类别 + 错误码，前端按类别说人话。
func writeXaiLoginError(c *gin.Context, err error) {
	if failure, ok := err.(*service.XaiLoginFailure); ok {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "",
			"data": gin.H{
				"status": "failed",
				"reason": failure.Reason,
				"code":   failure.Code,
			},
		})
		return
	}
	common.ApiError(c, err)
}

// EnsureXaiSubscriptionModelsFree 把订阅渠道的模型补为 0 价：订阅用量本身不另收费，
// 未配置过价格的模型若不显式置 0，会落到默认倍率上向下游收费。
// 已配置过价格（管理员手工调过）的一律不覆盖。
func EnsureXaiSubscriptionModelsFree(channels []model.Channel) {
	if len(channels) == 0 {
		return
	}
	models := make([]string, 0, 16)
	seen := make(map[string]bool, 16)
	for i := range channels {
		if channels[i].Type != constant.ChannelTypeXaiSub {
			continue
		}
		for _, m := range channels[i].GetModels() {
			name := strings.TrimSpace(m)
			if name == "" || seen[name] {
				continue
			}
			seen[name] = true
			models = append(models, name)
		}
	}
	if len(models) == 0 {
		return
	}
	fillMissingZeroPrice("ModelRatio", ratio_setting.ModelRatio2JSONString(), models)
	fillMissingZeroPrice("CompletionRatio", ratio_setting.CompletionRatio2JSONString(), models)
}

// fillMissingZeroPrice 只为还没配过价的模型补 0。注意 UpdateModelPricingOptions 对某个键是
// 整表替换（不是合并），所以必须把「读到的现表 + 新增的 0」一起传回去，否则会冲掉管理员
// 已经调过的价。
func fillMissingZeroPrice(optionKey, currentJSON string, models []string) {
	current := make(map[string]float64)
	if err := common.UnmarshalJsonStr(currentJSON, &current); err != nil {
		return
	}
	changed := false
	for _, name := range models {
		if _, ok := current[name]; !ok {
			current[name] = 0
			changed = true
		}
	}
	if !changed {
		return
	}
	encoded, err := common.Marshal(current)
	if err != nil {
		return
	}
	if err := model.UpdateModelPricingOptions(map[string]string{optionKey: string(encoded)}); err != nil {
		common.SysError(common.LogText("xai subscription: failed to default %s to zero: %s", optionKey, err.Error()))
	}
}
