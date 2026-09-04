package middleware

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// sseBody 将 data 载荷列表拼装为 SSE 报文（每条载荷一个事件块）
func sseBody(payloads ...string) string {
	body := ""
	for _, payload := range payloads {
		body += "data: " + payload + "\n\n"
	}
	return body
}

// assertMergedJson 断言合并结果与期望 JSON 深度相等（忽略键序、保留数组顺序）
func assertMergedJson(t *testing.T, merged string, expectedJson string) {
	t.Helper()
	var actual, expected any
	require.NoError(t, common.UnmarshalJsonStr(merged, &actual), "合并结果必须是合法 JSON: %s", merged)
	require.NoError(t, common.UnmarshalJsonStr(expectedJson, &expected))
	assert.Equal(t, expected, actual)
}

func TestParseSSEDataPayloads(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want []string
	}{
		{
			name: "标准事件流（含 event 行、注释、CRLF、[DONE]）",
			raw:  ": keep-alive\r\n\r\nevent: message\r\ndata: {\"a\":1}\r\n\r\ndata: [DONE]\r\n\r\n",
			want: []string{`{"a":1}`},
		},
		{
			name: "同一事件内多行 data 按规范以换行连接",
			raw:  "data: {\"a\":\ndata: 1}\n\n",
			want: []string{"{\"a\":\n1}"},
		},
		{
			name: "无 data 行返回空",
			raw:  "event: ping\n\n: comment\n\n",
			want: nil,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, parseSSEDataPayloads(tt.raw))
		})
	}
}

func TestMergeStreamResponseBodyOpenAIChat(t *testing.T) {
	t.Run("纯文本流合并为单个 chat.completion", func(t *testing.T) {
		raw := sseBody(
			`{"id":"chatcmpl-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","system_fingerprint":"fp_1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}`,
			`{"id":"chatcmpl-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","system_fingerprint":"fp_1","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}`,
			`{"id":"chatcmpl-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","system_fingerprint":"fp_1","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":"stop"}]}`,
			`{"id":"chatcmpl-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","system_fingerprint":"fp_1","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}`,
			"[DONE]",
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"chatcmpl-1","object":"chat.completion","created":1700000000,"model":"gpt-4o","system_fingerprint":"fp_1",
			"choices":[{"index":0,"message":{"role":"assistant","content":"Hello world"},"finish_reason":"stop"}],
			"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}
		}`)
	})

	t.Run("tool_calls 分片按 index 拼接 arguments", func(t *testing.T) {
		raw := sseBody(
			`{"id":"chatcmpl-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}`,
			`{"id":"chatcmpl-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"city\":"}}]},"finish_reason":null}]}`,
			`{"id":"chatcmpl-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"Paris\"}"}}]},"finish_reason":null}]}`,
			`{"id":"chatcmpl-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
			"[DONE]",
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"chatcmpl-2","object":"chat.completion","created":1700000000,"model":"gpt-4o",
			"choices":[{"index":0,"message":{"role":"assistant","tool_calls":[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"Paris\"}"}}]},"finish_reason":"tool_calls"}]
		}`)
	})

	t.Run("reasoning_content 与 content 分别拼接", func(t *testing.T) {
		raw := sseBody(
			`{"id":"chatcmpl-3","object":"chat.completion.chunk","created":1700000000,"model":"deepseek-chat","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"think "}}]}`,
			`{"id":"chatcmpl-3","object":"chat.completion.chunk","created":1700000000,"model":"deepseek-chat","choices":[{"index":0,"delta":{"reasoning_content":"hard","content":"Hi"}}]}`,
			`{"id":"chatcmpl-3","object":"chat.completion.chunk","created":1700000000,"model":"deepseek-chat","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"chatcmpl-3","object":"chat.completion","created":1700000000,"model":"deepseek-chat",
			"choices":[{"index":0,"message":{"role":"assistant","content":"Hi","reasoning_content":"think hard"},"finish_reason":"stop"}]
		}`)
	})

	t.Run("多 choice 按各自 index 归并", func(t *testing.T) {
		raw := sseBody(
			`{"id":"chatcmpl-4","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":1,"delta":{"content":"B"}},{"index":0,"delta":{"content":"A"}}]}`,
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"chatcmpl-4","object":"chat.completion","created":1700000000,"model":"gpt-4o",
			"choices":[
				{"index":1,"message":{"role":"assistant","content":"B"},"finish_reason":null},
				{"index":0,"message":{"role":"assistant","content":"A"},"finish_reason":null}
			]
		}`)
	})

	t.Run("流中错误载荷并入 error 字段", func(t *testing.T) {
		raw := sseBody(
			`{"id":"chatcmpl-5","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"partial"}}]}`,
			`{"error":{"message":"overloaded","type":"server_error"}}`,
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"chatcmpl-5","object":"chat.completion","created":1700000000,"model":"gpt-4o",
			"choices":[{"index":0,"message":{"role":"assistant","content":"partial"},"finish_reason":null}],
			"error":{"message":"overloaded","type":"server_error"}
		}`)
	})

	t.Run("字符串型错误载荷与类型不符分片不再整块丢弃", func(t *testing.T) {
		raw := sseBody(
			`{"id":"chatcmpl-6","object":"chat.completion.chunk","created":"1700000000","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hi"}}]}`,
			`{"error":"rate limited"}`,
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"chatcmpl-6","object":"chat.completion","model":"gpt-4o",
			"choices":[{"index":0,"message":{"role":"assistant","content":"Hi"},"finish_reason":null}],
			"error":"rate limited"
		}`)
	})

	t.Run("音频输出模态按 id/data/transcript 跨分片拼接", func(t *testing.T) {
		raw := sseBody(
			`{"id":"chatcmpl-a1","object":"chat.completion.chunk","created":1730000000,"model":"gpt-4o-audio","choices":[{"index":0,"delta":{"role":"assistant"}}]}`,
			`{"id":"chatcmpl-a1","object":"chat.completion.chunk","created":1730000000,"model":"gpt-4o-audio","choices":[{"index":0,"delta":{"audio":{"id":"audio-1","data":"QUJD","transcript":"你好"}}}]}`,
			`{"id":"chatcmpl-a1","object":"chat.completion.chunk","created":1730000000,"model":"gpt-4o-audio","choices":[{"index":0,"delta":{"audio":{"data":"REVG","transcript":"世界"}}}]}`,
			`{"id":"chatcmpl-a1","object":"chat.completion.chunk","created":1730000000,"model":"gpt-4o-audio","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":30}}`,
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"chatcmpl-a1","object":"chat.completion","created":1730000000,"model":"gpt-4o-audio",
			"choices":[{"index":0,"message":{"role":"assistant","audio":{"id":"audio-1","data":"QUJDREVG","transcript":"你好世界"}},"finish_reason":"stop"}],
			"usage":{"total_tokens":30}
		}`)
	})

	t.Run("未建模扩展字段按规则保留（annotations 数组拼接、logprobs 对象合并）", func(t *testing.T) {
		raw := sseBody(
			`{"id":"chatcmpl-x","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"See ","annotations":[{"type":"url_citation","url":"https://a"}]},"logprobs":{"content":[{"token":"See"}]}}]}`,
			`{"id":"chatcmpl-x","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"this.","annotations":[{"type":"url_citation","url":"https://b"}]},"logprobs":{"content":[{"token":"this."}]}}]}`,
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"chatcmpl-x","object":"chat.completion","created":1,"model":"m",
			"choices":[{
				"index":0,
				"message":{"role":"assistant","content":"See this.","annotations":[{"type":"url_citation","url":"https://a"},{"type":"url_citation","url":"https://b"}]},
				"finish_reason":null,
				"logprobs":{"content":[{"token":"See"},{"token":"this."}]}
			}]
		}`)
	})

	t.Run("tool_calls 分片缺失 index 时按 id 开启新调用", func(t *testing.T) {
		raw := sseBody(
			`{"id":"chatcmpl-2t","object":"chat.completion.chunk","created":1,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"id":"call_aaa","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"Paris\"}"}}]}}]}`,
			`{"id":"chatcmpl-2t","object":"chat.completion.chunk","created":1,"model":"gpt-4o","choices":[{"index":0,"delta":{"tool_calls":[{"id":"call_bbb","type":"function","function":{"name":"get_time","arguments":""}}]}}]}`,
			`{"id":"chatcmpl-2t","object":"chat.completion.chunk","created":1,"model":"gpt-4o","choices":[{"index":0,"delta":{"tool_calls":[{"function":{"arguments":"{\"tz\":\"PST\"}"}}]},"finish_reason":"tool_calls"}]}`,
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"chatcmpl-2t","object":"chat.completion","created":1,"model":"gpt-4o",
			"choices":[{"index":0,"message":{"role":"assistant","tool_calls":[
				{"id":"call_aaa","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"Paris\"}"}},
				{"id":"call_bbb","type":"function","function":{"name":"get_time","arguments":"{\"tz\":\"PST\"}"}}
			]},"finish_reason":"tool_calls"}]
		}`)
	})
}

func TestMergeStreamResponseBodyClaude(t *testing.T) {
	t.Run("text 与 tool_use 块合并且 usage 以 message_delta 覆盖", func(t *testing.T) {
		raw := sseBody(
			`{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-4","content":[],"usage":{"input_tokens":25,"output_tokens":1}}}`,
			`{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello "}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}`,
			`{"type":"content_block_stop","index":0}`,
			`{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{}}}`,
			`{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"city\":"}}`,
			`{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"Paris\"}"}}`,
			`{"type":"content_block_stop","index":1}`,
			`{"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":42}}`,
			`{"type":"message_stop"}`,
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-4",
			"content":[
				{"type":"text","text":"Hello world"},
				{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{"city":"Paris"}}
			],
			"stop_reason":"tool_use","stop_sequence":null,
			"usage":{"input_tokens":25,"output_tokens":42}
		}`)
	})

	t.Run("thinking 块累积 thinking 与 signature", func(t *testing.T) {
		raw := sseBody(
			`{"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","model":"claude-sonnet-4","usage":{"input_tokens":10,"output_tokens":1}}}`,
			`{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"let me "}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"think"}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-abc"}}`,
			`{"type":"content_block_stop","index":0}`,
			`{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}`,
			`{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"answer"}}`,
			`{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":30}}`,
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"msg_2","type":"message","role":"assistant","model":"claude-sonnet-4",
			"content":[
				{"type":"thinking","thinking":"let me think","signature":"sig-abc"},
				{"type":"text","text":"answer"}
			],
			"stop_reason":"end_turn","stop_sequence":null,
			"usage":{"input_tokens":10,"output_tokens":30}
		}`)
	})

	t.Run("中断流未停止的块也定稿并保留 error 事件", func(t *testing.T) {
		raw := sseBody(
			`{"type":"message_start","message":{"id":"msg_3","type":"message","role":"assistant","model":"claude-sonnet-4","usage":{"input_tokens":8}}}`,
			`{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}`,
			`{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`,
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"msg_3","type":"message","role":"assistant","model":"claude-sonnet-4",
			"content":[{"type":"text","text":"partial"}],
			"stop_reason":null,"stop_sequence":null,
			"usage":{"input_tokens":8},
			"error":{"type":"overloaded_error","message":"Overloaded"}
		}`)
	})

	t.Run("仅错误事件输出 type=error", func(t *testing.T) {
		raw := sseBody(`{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`)
	})

	t.Run("citations_delta 引用对象并入块的 citations 数组", func(t *testing.T) {
		raw := sseBody(
			`{"type":"message_start","message":{"id":"msg_4","type":"message","role":"assistant","model":"claude-sonnet-4","usage":{"input_tokens":10,"output_tokens":1}}}`,
			`{"type":"content_block_start","index":0,"content_block":{"type":"text","text":"","citations":[]}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"See docs."}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"citations_delta","citation":{"type":"web_search_result_location","url":"https://a"}}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"citations_delta","citation":{"type":"web_search_result_location","url":"https://b"}}}`,
			`{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}`,
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"msg_4","type":"message","role":"assistant","model":"claude-sonnet-4",
			"content":[{"type":"text","text":"See docs.","citations":[
				{"type":"web_search_result_location","url":"https://a"},
				{"type":"web_search_result_location","url":"https://b"}
			]}],
			"stop_reason":"end_turn","stop_sequence":null,
			"usage":{"input_tokens":10,"output_tokens":20}
		}`)
	})

	t.Run("中断截断的 partial_json 以 input_raw 保留原文", func(t *testing.T) {
		raw := sseBody(
			`{"type":"message_start","message":{"id":"msg_5","type":"message","role":"assistant","model":"claude-sonnet-4","usage":{"input_tokens":5}}}`,
			`{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_9","name":"get_weather","input":{}}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"city\": \"San"}}`,
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"msg_5","type":"message","role":"assistant","model":"claude-sonnet-4",
			"content":[{"type":"tool_use","id":"toolu_9","name":"get_weather","input":{},"input_raw":"{\"city\": \"San"}],
			"stop_reason":null,"stop_sequence":null,
			"usage":{"input_tokens":5}
		}`)
	})
}

func TestMergeStreamResponseBodyGemini(t *testing.T) {
	t.Run("text 分片拼接且保留非文本 part", func(t *testing.T) {
		raw := sseBody(
			`{"candidates":[{"content":{"parts":[{"text":"Hi"}],"role":"model"},"index":0}],"modelVersion":"gemini-2.0"}`,
			`{"candidates":[{"content":{"parts":[{"text":" there"},{"functionCall":{"name":"f","args":{"x":1}}}],"role":"model"},"index":0,"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2,"totalTokenCount":7}}`,
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"candidates":[{
				"content":{"role":"model","parts":[{"text":"Hi there"},{"functionCall":{"name":"f","args":{"x":1}}}]},
				"finishReason":"STOP","index":0
			}],
			"modelVersion":"gemini-2.0",
			"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2,"totalTokenCount":7}
		}`)
	})

	t.Run("part 顺序保持不变且 candidate 级字段保留", func(t *testing.T) {
		raw := sseBody(
			`{"candidates":[{"content":{"parts":[{"text":"先想一想：2+2 等于 4。","thought":true}],"role":"model"},"index":0}]}`,
			`{"candidates":[{"content":{"parts":[{"text":"，因为 2+2=4。","thought":true}],"role":"model"},"index":0}]}`,
			`{"candidates":[{"content":{"parts":[{"text":"答案是 4","thoughtSignature":"sig-x"}],"role":"model"},"index":0,"finishReason":"STOP","groundingMetadata":{"groundingChunks":[{"web":{"title":"src"}}]}}]}`,
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"candidates":[{
				"content":{"role":"model","parts":[
					{"text":"先想一想：2+2 等于 4。，因为 2+2=4。","thought":true},
					{"text":"答案是 4","thoughtSignature":"sig-x"}
				]},
				"finishReason":"STOP","index":0,
				"groundingMetadata":{"groundingChunks":[{"web":{"title":"src"}}]}
			}]
		}`)
	})
}

func TestMergeStreamResponseBodyResponses(t *testing.T) {
	t.Run("提取 response.completed 终态事件中的完整 response", func(t *testing.T) {
		raw := "event: response.output_text.delta\n" + sseBody(
			`{"type":"response.output_text.delta","delta":"Hi"}`,
			`{"type":"response.completed","response":{"id":"resp_1","object":"response","status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"Hi"}]}]}}`,
		)
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"resp_1","object":"response","status":"completed",
			"output":[{"type":"message","content":[{"type":"output_text","text":"Hi"}]}]
		}`)
	})

	t.Run("无终态事件回退原始报文", func(t *testing.T) {
		raw := sseBody(`{"type":"response.output_text.delta","delta":"Hi"}`)
		assert.Equal(t, raw, mergeStreamResponseBody(raw))
	})
}

func TestMergeStreamResponseBodyFallback(t *testing.T) {
	tests := []struct {
		name string
		raw  string
	}{
		{name: "空响应体", raw: ""},
		{name: "非 SSE 的普通 JSON 体", raw: `{"error":{"message":"bad request"}}`},
		{
			name: "未识别的 SSE 格式原样保留",
			raw:  sseBody(`{"custom":{"chunk":"x"}}`, `{"custom":{"chunk":"y"}}`),
		},
		{
			name: "全部载荷非法 JSON 原样保留",
			raw:  "data: {truncated\n\ndata: [DONE]\n\n",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.raw, mergeStreamResponseBody(tt.raw))
		})
	}

	t.Run("混合载荷合并时忽略非法分片", func(t *testing.T) {
		raw := sseBody(`{"id":"c1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"ok"}}]}`, "{truncated")
		assertMergedJson(t, mergeStreamResponseBody(raw), `{
			"id":"c1","object":"chat.completion","created":1,"model":"m",
			"choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":null}]
		}`)
	})
}
