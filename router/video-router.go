package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

func SetVideoRouter(router *gin.Engine) {
	videoSharedRouter := router.Group("/v1")
	videoSharedRouter.Use(middleware.RouteTag("relay"))
	videoSharedRouter.Use(middleware.TokenAuth())
	videoSharedRouter.Use(middleware.SystemPerformanceCheck())
	videoSharedRouter.POST(
		"/video/generations",
		middleware.PinTaskPluginEndpoint(),
		middleware.TaskPluginEndpointOnly(middleware.ModelRequestRateLimit()),
		middleware.PrepareTaskPluginEndpoint(),
		middleware.Distribute(),
		// 与 /v1 relay 路由组一致：录制任务创建的出入参报文，
		// 供 Log4 详情弹窗按 request_id 关联查看提示词与任务 ID
		middleware.ResponseRecorderMiddleware(model.SaveRequestResponseLog),
		func(c *gin.Context) {
			controller.RelayTaskPluginEndpoint(c, controller.RelayTask)
		},
	)

	videoV1Router := router.Group("/v1")
	videoV1Router.Use(middleware.RouteTag("relay"))
	videoV1Router.Use(middleware.TokenAuth(), middleware.Distribute())
	{
		videoV1Router.GET("/video/generations/:task_id", controller.RelayTaskFetch)
		// 排队中的视频任务可取消；已经进入上游生成中的请求由控制器拒绝。
		videoV1Router.DELETE("/video/generations/:task_id", controller.RelayVideoCancel)
		videoV1Router.DELETE("/videos/:task_id", controller.RelayVideoCancel)
		// remix 同样是视频任务创建，报文一并录制
		videoV1Router.POST(
			"/videos/:video_id/remix",
			middleware.ResponseRecorderMiddleware(model.SaveRequestResponseLog),
			controller.RelayTask,
		)
	}
}
