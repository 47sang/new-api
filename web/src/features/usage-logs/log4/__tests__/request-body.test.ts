/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { describe, expect, test } from 'vitest'

import {
  estimateMessageTokens,
  extractMessageImages,
  matchesGenerationRequestPath,
  parseRequestBody,
  parseResponseBody,
  type ParsedRequest,
} from '../request-body'

/** Test fixture: parse a body known to be a chat request, never generation. */
function parseChatBody(body: string): ParsedRequest | null {
  const parsed = parseRequestBody(body)
  return parsed && parsed.format !== 'generation' ? parsed : null
}

describe('parseRequestBody — OpenAI Chat Completions', () => {
  test('parses string and array content, tool roles and tool calls', () => {
    const body = JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look at this:' },
            { type: 'image_url', image_url: { url: 'https://x/y.png' } },
          ],
        },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"SF"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'sunny, 20C' },
      ],
    })

    const parsed = parseChatBody(body)
    expect(parsed?.format).toBe('openai')
    expect(parsed?.messages).toHaveLength(4)
    expect(parsed?.messages[0]).toMatchObject({
      role: 'system',
      text: 'You are helpful.',
    })
    expect(parsed?.messages[1]).toMatchObject({
      role: 'user',
      text: 'Look at this:',
      imageCount: 1,
    })
    expect(parsed?.messages[2].toolCalls).toEqual([
      { name: 'get_weather', arguments: '{"city":"SF"}' },
    ])
    expect(parsed?.messages[3]).toMatchObject({
      role: 'tool',
      text: 'sunny, 20C',
    })
  })

  test('treats the developer role as system', () => {
    const parsed = parseChatBody(
      JSON.stringify({ messages: [{ role: 'developer', content: 'rules' }] })
    )
    expect(parsed?.messages[0]?.role).toBe('system')
  })
})

describe('parseRequestBody — Claude Messages', () => {
  test('parses the top-level system prompt and content blocks', () => {
    const body = JSON.stringify({
      model: 'claude-sonnet-5',
      system: [{ type: 'text', text: 'Be concise.' }],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Read the file',
              cache_control: { type: 'ephemeral' },
            },
            { type: 'image', source: { type: 'base64' } },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'hmm' },
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'Read',
              input: { path: '/a.go' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: 'file body' },
          ],
        },
      ],
    })

    const parsed = parseChatBody(body)
    expect(parsed?.format).toBe('claude')
    expect(parsed?.messages).toHaveLength(4)
    expect(parsed?.messages[0]).toMatchObject({
      role: 'system',
      text: 'Be concise.',
    })
    expect(parsed?.messages[1]).toMatchObject({
      role: 'user',
      text: 'Read the file',
      imageCount: 1,
      cached: true,
    })
    expect(parsed?.messages[2].toolCalls).toEqual([
      { name: 'Read', arguments: '{\n  "path": "/a.go"\n}' },
    ])
    // A user turn reporting a tool result is displayed as the Tool role.
    expect(parsed?.messages[3]).toMatchObject({
      role: 'tool',
      toolResults: [{ id: 'tu_1', content: 'file body' }],
    })
  })

  test('detects Claude requests without a system field via block types', () => {
    const parsed = parseChatBody(
      JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 64,
        messages: [
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }],
          },
        ],
      })
    )
    expect(parsed?.format).toBe('claude')
  })
})

describe('parseRequestBody — Gemini GenerateContent', () => {
  test('parses systemInstruction, model role and function parts', () => {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: 'Be safe.' }] },
      contents: [
        { role: 'user', parts: [{ text: 'Hi' }] },
        {
          role: 'model',
          parts: [{ functionCall: { name: 'ping', args: { n: 1 } } }],
        },
        {
          role: 'user',
          parts: [
            { functionResponse: { name: 'ping', response: { ok: true } } },
          ],
        },
      ],
    })

    const parsed = parseChatBody(body)
    expect(parsed?.format).toBe('gemini')
    expect(parsed?.messages).toHaveLength(4)
    expect(parsed?.messages[0]).toMatchObject({
      role: 'system',
      text: 'Be safe.',
    })
    expect(parsed?.messages[1]).toMatchObject({ role: 'user', text: 'Hi' })
    expect(parsed?.messages[2]).toMatchObject({ role: 'assistant' })
    expect(parsed?.messages[2].toolCalls).toEqual([
      { name: 'ping', arguments: '{\n  "n": 1\n}' },
    ])
    expect(parsed?.messages[3].role).toBe('user')
    expect(parsed?.messages[3].toolResults).toEqual([
      { id: 'ping', content: '{\n  "ok": true\n}' },
    ])
  })
})

describe('parseRequestBody — OpenAI Responses', () => {
  test('parses instructions, string input and function call items', () => {
    const body = JSON.stringify({
      model: 'gpt-5',
      instructions: 'Follow policy.',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
        {
          type: 'function_call',
          name: 'lookup',
          arguments: '{"q":"x"}',
        },
        { type: 'function_call_output', call_id: 'c1', output: '{"r":1}' },
      ],
    })

    const parsed = parseChatBody(body)
    expect(parsed?.format).toBe('responses')
    expect(parsed?.messages).toHaveLength(4)
    expect(parsed?.messages[0]).toMatchObject({
      role: 'system',
      text: 'Follow policy.',
    })
    expect(parsed?.messages[1]).toMatchObject({ role: 'user', text: 'Hello' })
    expect(parsed?.messages[2].toolCalls).toEqual([
      { name: 'lookup', arguments: '{"q":"x"}' },
    ])
    expect(parsed?.messages[3]).toMatchObject({
      role: 'tool',
      toolResults: [{ id: 'c1', content: '{"r":1}' }],
    })
  })

  test('parses plain string input as a single user message', () => {
    const parsed = parseChatBody(
      JSON.stringify({ model: 'gpt-5', input: 'Just ask me' })
    )
    expect(parsed?.messages).toEqual([
      { role: 'user', text: 'Just ask me', raw: 'Just ask me' },
    ])
  })
})

describe('parseRequestBody — unsupported bodies', () => {
  test('returns null for empty, invalid, non-object and multipart bodies', () => {
    expect(parseRequestBody('')).toBeNull()
    expect(parseRequestBody('not json')).toBeNull()
    expect(parseRequestBody('[1,2,3]')).toBeNull()
    expect(parseRequestBody('[multipart request body omitted]')).toBeNull()
    expect(parseRequestBody('{"model":"text-embedding-3"}')).toBeNull()
  })
})

describe('parseResponseBody', () => {
  test('parses an OpenAI chat completion with reasoning and tool calls', () => {
    const parsed = parseResponseBody(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Answer',
              reasoning_content: 'thinking hard',
              tool_calls: [
                {
                  type: 'function',
                  function: { name: 'f', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      })
    )
    expect(parsed).toMatchObject({
      format: 'openai',
      content: 'Answer',
      reasoning: 'thinking hard',
      toolCalls: [{ name: 'f', arguments: '{}' }],
      finishReason: 'tool_calls',
    })
  })

  test('parses a stream-merged Claude message with thinking blocks', () => {
    const parsed = parseResponseBody(
      JSON.stringify({
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'step 1\nstep 2' },
          { type: 'text', text: 'Final' },
        ],
        stop_reason: 'end_turn',
      })
    )
    expect(parsed).toMatchObject({
      format: 'claude',
      reasoning: 'step 1\nstep 2',
      content: 'Final',
      finishReason: 'end_turn',
    })
  })

  test('parses a Gemini candidate separating thought parts from text', () => {
    const parsed = parseResponseBody(
      JSON.stringify({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'reasoning...' }, { text: 'Visible' }],
            },
            finishReason: 'STOP',
          },
        ],
      })
    )
    // Without the thought marker every part is ordinary output text.
    expect(parsed?.format).toBe('gemini')
    expect(parsed?.content).toBe('reasoning...\n\nVisible')
  })

  test('parses Gemini thought parts into reasoning', () => {
    const parsed = parseResponseBody(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: 'quiet thinking', thought: true },
                { text: 'Answer' },
              ],
            },
          },
        ],
      })
    )
    expect(parsed?.reasoning).toBe('quiet thinking')
    expect(parsed?.content).toBe('Answer')
  })

  test('parses an OpenAI Responses output array', () => {
    const parsed = parseResponseBody(
      JSON.stringify({
        output: [
          {
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: 'why' }],
          },
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Done' }],
          },
        ],
        status: 'completed',
      })
    )
    expect(parsed).toMatchObject({
      format: 'responses',
      reasoning: 'why',
      content: 'Done',
      finishReason: 'completed',
    })
  })

  test('surfaces stream errors', () => {
    const parsed = parseResponseBody(
      JSON.stringify({ error: { message: 'rate limited' } })
    )
    expect(parsed?.error).toBe('rate limited')
  })

  test('extracts audio output as a playable data URI sniffed from base64 magic', () => {
    const parsed = parseResponseBody(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
              audio: {
                id: 'a1',
                // base64 of RIFF/WAVE bytes — no format field, as OpenAI
                // audio objects omit it (the format is request-side).
                data: 'UklGRi4A',
                transcript: 'Hello there',
              },
            },
          },
        ],
      })
    )
    expect(parsed?.audio?.url).toBe('data:audio/wav;base64,UklGRi4A')
    expect(parsed?.content).toBe('Hello there')
  })

  test('prefers an explicitly declared audio format over the sniffed one', () => {
    const parsed = parseResponseBody(
      JSON.stringify({
        choices: [{ message: { audio: { data: 'UklGRi4A', format: 'mp3' } } }],
      })
    )
    expect(parsed?.audio?.url).toBe('data:audio/mpeg;base64,UklGRi4A')
  })

  test('falls back to the mp3 demuxer for payloads without a known signature', () => {
    const parsed = parseResponseBody(
      JSON.stringify({
        choices: [{ message: { audio: { data: 'cmF3' } } }],
      })
    )
    expect(parsed?.audio?.url).toBe('data:audio/mpeg;base64,cmF3')
  })

  test('sniffs each audio container signature to its media type', () => {
    // base64 of each container's file magic, including the AAC/MP3 frame
    // variants that share the 0xFF 0xFx MPEG sync.
    const cases: Array<[data: string, mediaType: string]> = [
      ['UklGRi4A', 'audio/wav'], // RIFF/WAVE
      ['T2dnUwJ/', 'audio/ogg'], // OggS (Opus speech)
      ['ZkxhQwh1', 'audio/flac'], // fLaC
      ['//EA//7u', 'audio/aac'], // ADTS 0xFF 0xF1 (MPEG-4)
      ['//mA//7u', 'audio/aac'], // ADTS 0xFF 0xF9 (MPEG-2)
      ['//uQxAAA', 'audio/mpeg'], // raw MP3 frame 0xFF 0xFB
      ['SUQzAwAA', 'audio/mpeg'], // ID3-tagged MP3
    ]
    for (const [data, mediaType] of cases) {
      const parsed = parseResponseBody(
        JSON.stringify({ choices: [{ message: { audio: { data } } }] })
      )
      expect(parsed?.audio?.url).toBe(`data:${mediaType};base64,${data}`)
    }
  })

  test('ignores non-string or empty audio data instead of building a broken URI', () => {
    for (const data of [123, '']) {
      const parsed = parseResponseBody(
        JSON.stringify({ choices: [{ message: { audio: { data } } }] })
      )
      expect(parsed?.audio).toBeUndefined()
    }
  })

  test('keeps transcript-only audio objects without building a data URI', () => {
    const parsed = parseResponseBody(
      JSON.stringify({
        choices: [{ message: { audio: { transcript: 'spoken words' } } }],
      })
    )
    expect(parsed?.audio).toBeUndefined()
    expect(parsed?.content).toBe('spoken words')
  })

  test('surfaces string-typed error payloads on merged streams', () => {
    // Stream-merged error-only payload produced by the backend merger
    // (see middleware/response_stream_merge.go): empty choices + string error.
    const merged = parseResponseBody(
      JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion',
        choices: [],
        error: 'rate limited',
      })
    )
    expect(merged?.error).toBe('rate limited')

    // Partial content followed by a string error keeps both.
    const partial = parseResponseBody(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'partial' } }],
        error: 'rate limited',
      })
    )
    expect(partial?.content).toBe('partial')
    expect(partial?.error).toBe('rate limited')

    // A bare string-error payload also surfaces.
    expect(parseResponseBody(JSON.stringify({ error: 'boom' }))?.error).toBe(
      'boom'
    )
  })

  test('parses Gemini function-call responses into tool calls', () => {
    const parsed = parseResponseBody(
      JSON.stringify({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { functionCall: { name: 'get_weather', args: { city: 'SF' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      })
    )
    expect(parsed?.toolCalls).toEqual([
      { name: 'get_weather', arguments: '{\n  "city": "SF"\n}' },
    ])
    expect(parsed?.finishReason).toBe('STOP')
  })

  test('labels Responses function_call items as assistant and parses legacy shapes', () => {
    const parsed = parseChatBody(
      JSON.stringify({
        model: 'gpt-5',
        input: [
          { type: 'function_call', name: 'lookup', arguments: '{"q":"x"}' },
        ],
      })
    )
    expect(parsed?.messages[0]?.role).toBe('assistant')

    // Legacy OpenAI non-stream shapes: function_call + audio transcript.
    const legacy = parseResponseBody(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              function_call: { name: 'get_weather', arguments: '{}' },
              audio: { transcript: 'Hello there' },
            },
          },
        ],
      })
    )
    expect(legacy?.toolCalls).toEqual([
      { name: 'get_weather', arguments: '{}' },
    ])
    expect(legacy?.content).toBe('Hello there')
  })

  test('keeps Claude text documents and prefers the OpenAI parser for OpenAI-only shapes', () => {
    const document = parseChatBody(
      JSON.stringify({
        system: 'sys',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                title: 'notes',
                source: { type: 'text', data: 'doc body' },
              },
            ],
          },
        ],
      })
    )
    expect(document?.format).toBe('claude')
    // messages[0] is the top-level system prompt; the document turn follows.
    expect(document?.messages[1]?.text).toContain('doc body')

    // A `system` field alone must not route an OpenAI Chat body with
    // assistant tool_calls into the Claude parser.
    const openai = parseChatBody(
      JSON.stringify({
        system: 'ignored custom field',
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              { type: 'function', function: { name: 'f', arguments: '{}' } },
            ],
          },
          { role: 'tool', content: 'result' },
        ],
      })
    )
    expect(openai?.format).toBe('openai')
    expect(openai?.messages[0]?.role).toBe('assistant')
    expect(openai?.messages[1]?.role).toBe('tool')
  })

  test('returns null for empty and raw SSE bodies', () => {
    expect(parseResponseBody('')).toBeNull()
    expect(
      parseResponseBody('data: {"choices":[]}\n\ndata: [DONE]\n\n')
    ).toBeNull()
  })
})

describe('estimateMessageTokens', () => {
  test('estimates from text plus tool call and result payloads', () => {
    const tokens = estimateMessageTokens({
      role: 'assistant',
      text: 'abcd'.repeat(100),
      toolCalls: [{ name: 'n', arguments: '{"k":"v"}' }],
      toolResults: [{ id: '1', content: 'result' }],
      raw: null,
    })
    // 400 + 10 + 6 chars -> ceil(416 / 4)
    expect(tokens).toBe(104)
  })
})

describe('extractMessageImages', () => {
  test('builds data URIs from Claude base64 sources and passes url sources through', () => {
    const raw = {
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'AAAA',
          },
        },
        {
          type: 'image',
          source: { type: 'url', url: 'https://x/y.png' },
        },
      ],
    }
    expect(extractMessageImages(raw)).toEqual([
      { url: 'data:image/png;base64,AAAA', mediaType: 'image/png' },
      { url: 'https://x/y.png' },
    ])
  })

  test('collects OpenAI image_url objects and Responses input_image strings', () => {
    const chatPart = {
      content: [
        { type: 'image_url', image_url: { url: 'https://x/chat.png' } },
      ],
    }
    const responsesItem = {
      content: [
        { type: 'input_image', image_url: 'data:image/jpeg;base64,BBBB' },
      ],
    }
    expect(extractMessageImages(chatPart)).toEqual([
      { url: 'https://x/chat.png' },
    ])
    expect(extractMessageImages(responsesItem)).toEqual([
      { url: 'data:image/jpeg;base64,BBBB' },
    ])
  })

  test('builds data URIs from Gemini inlineData parts and skips fileData', () => {
    const raw = {
      parts: [
        { inlineData: { mimeType: 'image/webp', data: 'CCCC' } },
        { inline_data: { mime_type: 'image/gif', data: 'DDDD' } },
        {
          fileData: {
            fileUri: 'https://generativelanguage.googleapis.com/f/1',
          },
        },
      ],
    }
    expect(extractMessageImages(raw)).toEqual([
      { url: 'data:image/webp;base64,CCCC', mediaType: 'image/webp' },
      { url: 'data:image/gif;base64,DDDD', mediaType: 'image/gif' },
    ])
  })

  test('finds images nested inside Claude tool_result content', () => {
    const raw = {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'EEEE' },
            },
          ],
        },
      ],
    }
    expect(extractMessageImages(raw)).toEqual([
      { url: 'data:image/png;base64,EEEE', mediaType: 'image/png' },
    ])
  })

  test('skips non-renderable references and non-image payloads', () => {
    const raw = {
      content: [
        { type: 'image_file', image_file: { file_id: 'file-1' } },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: 'FFFF',
          },
        },
        { type: 'text', text: 'plain' },
      ],
    }
    expect(extractMessageImages(raw)).toEqual([])
  })

  test('returns an empty list for null, plain text and empty messages', () => {
    expect(extractMessageImages(null)).toEqual([])
    expect(extractMessageImages('hello')).toEqual([])
    expect(extractMessageImages({ content: 'plain text only' })).toEqual([])
  })
})

describe('parseRequestBody — generation requests', () => {
  test('parses an image generation body into prompt and parameters', () => {
    const parsed = parseRequestBody(
      JSON.stringify({
        model: 'doubao-seedream-5.0-lite',
        prompt: 'A character sheet, 4 views',
        response_format: 'url',
        watermark: false,
        size: '2K',
      })
    )
    expect(parsed?.format).toBe('generation')
    if (parsed?.format !== 'generation') return
    expect(parsed.prompt).toBe('A character sheet, 4 views')
    expect(parsed.params).toEqual([
      { key: 'model', value: 'doubao-seedream-5.0-lite' },
      { key: 'response_format', value: 'url' },
      { key: 'watermark', value: 'false' },
      { key: 'size', value: '2K' },
    ])
  })

  test('parses a video task creation body with nested metadata', () => {
    const parsed = parseRequestBody(
      JSON.stringify({
        model: 'doubao-seedance-2-0-mini-260615',
        prompt: 'A cat walks across the room',
        seconds: '5',
        metadata: { resolution: '720p' },
      })
    )
    expect(parsed?.format).toBe('generation')
    if (parsed?.format !== 'generation') return
    expect(parsed.prompt).toBe('A cat walks across the room')
    expect(parsed.params[2]).toEqual({
      key: 'metadata',
      value: '{\n  "resolution": "720p"\n}',
    })
  })

  test('keeps the legacy completions prompt unparseable as generation', () => {
    expect(
      parseRequestBody(
        JSON.stringify({
          model: 'gpt-3.5-turbo-instruct',
          prompt: 'Say hi',
          max_tokens: 16,
        })
      )
    ).toBeNull()
    // A prompt-only body without any generation parameter is not claimed.
    expect(
      parseRequestBody(JSON.stringify({ model: 'm', prompt: 'Say hi' }))
    ).toBeNull()
    // Non-string prompts (legacy array form) are not generation prompts.
    expect(
      parseRequestBody(
        JSON.stringify({ model: 'm', prompt: ['Say hi'], size: '2K' })
      )
    ).toBeNull()
    // An empty prompt is not a generation prompt even with image parameters.
    expect(
      parseRequestBody(JSON.stringify({ model: 'm', prompt: '', size: '2K' }))
    ).toBeNull()
    // A blank-string prompt is preserved as-is in the generation view.
    const blank = parseRequestBody(
      JSON.stringify({ model: 'm', prompt: '   ', size: '2K' })
    )
    expect(blank?.format).toBe('generation')
    if (blank?.format !== 'generation') return
    expect(blank.prompt).toBe('   ')
  })

  test('clips megabyte parameter values and marks them truncated', () => {
    const parsed = parseRequestBody(
      JSON.stringify({
        model: 'doubao-seedance-2-0-mini-260615',
        prompt: 'A cat walks',
        seconds: '5',
        // Video metadata embedding a huge payload stays a text parameter.
        metadata: { payload: 'A'.repeat(5000) },
      })
    )
    expect(parsed?.format).toBe('generation')
    if (parsed?.format !== 'generation') return
    const metadata = parsed.params.find((param) => param.key === 'metadata')
    expect(metadata?.truncated).toBe(true)
    expect(metadata?.value.length).toBe(2000)
    expect(
      parsed.params.find((param) => param.key === 'seconds')?.truncated
    ).toBeUndefined()
  })

  test('extracts image parameters into previewable attachments', () => {
    const parsed = parseRequestBody(
      JSON.stringify({
        prompt: 'Make the CRT monitor an LCD panel',
        image: 'https://assets.example.com/first.jpg',
        images: ['https://assets.example.com/second.jpg', 'file_nope'],
        watermark: false,
      })
    )
    expect(parsed?.format).toBe('generation')
    if (parsed?.format !== 'generation') return
    expect(parsed.images).toEqual([
      { url: 'https://assets.example.com/first.jpg' },
      { url: 'https://assets.example.com/second.jpg' },
    ])
    // Image parameters with renderable values move to the attachment
    // area entirely instead of staying in the text parameter list.
    expect(parsed.params.map((param) => param.key)).toEqual(['watermark'])
  })

  test('extracts inline base64 image payloads as data-URI attachments', () => {
    const payload = `data:image/png;base64,${'A'.repeat(5000)}`
    const parsed = parseRequestBody(
      JSON.stringify({ prompt: 'A cat walks', image: payload })
    )
    expect(parsed?.format).toBe('generation')
    if (parsed?.format !== 'generation') return
    expect(parsed.images).toEqual([{ url: payload }])
    expect(parsed.params).toEqual([])
  })

  test('keeps image parameters without renderable values as text', () => {
    const parsed = parseRequestBody(
      JSON.stringify({ prompt: 'A cat', image: 'file_abc123', size: '2K' })
    )
    expect(parsed?.format).toBe('generation')
    if (parsed?.format !== 'generation') return
    expect(parsed.images).toEqual([])
    expect(parsed.params).toEqual([
      { key: 'image', value: 'file_abc123' },
      { key: 'size', value: '2K' },
    ])
  })

  test('a chat envelope wins over the prompt heuristic', () => {
    const parsed = parseChatBody(
      JSON.stringify({
        model: 'gpt-4o',
        prompt: 'ignored legacy field',
        messages: [{ role: 'user', content: 'Hello' }],
      })
    )
    expect(parsed?.format).toBe('openai')
    expect(parsed?.messages).toHaveLength(1)
  })
})

describe('matchesGenerationRequestPath', () => {
  test('accepts generation endpoints and unknown paths', () => {
    expect(matchesGenerationRequestPath('/v1/images/generations')).toBe(true)
    expect(matchesGenerationRequestPath('/v1/video/generations')).toBe(true)
    expect(matchesGenerationRequestPath('/v1/videos')).toBe(true)
    expect(matchesGenerationRequestPath('/v1/videos/video_1/remix')).toBe(true)
    // Older logs may not carry request_path at all; trust the body heuristic.
    expect(matchesGenerationRequestPath(undefined)).toBe(true)
  })

  test('rejects chat and completion paths', () => {
    expect(matchesGenerationRequestPath('/v1/chat/completions')).toBe(false)
    expect(matchesGenerationRequestPath('/v1/completions')).toBe(false)
    expect(matchesGenerationRequestPath('/v1/messages')).toBe(false)
  })
})

describe('parseResponseBody — image generation', () => {
  test('collects generated images from url entries', () => {
    const parsed = parseResponseBody(
      JSON.stringify({
        model: 'doubao-seedream-5.0-lite',
        created: 1780921157,
        data: [
          { url: 'https://ark.example/a.jpeg', size: '3136x1344' },
          { url: 'not-a-url', size: '1x1' },
        ],
        usage: { generated_images: 2 },
      })
    )
    expect(parsed?.images).toEqual([{ url: 'https://ark.example/a.jpeg' }])
    expect(parsed?.content).toBeUndefined()
  })

  test('turns b64_json payloads into sniffed data URIs', () => {
    // node-verified magic prefixes: PNG 89504e47..., JPEG ffd8ff,
    // WEBP (RIFF) 52494646, GIF8 47494638.
    const cases = [
      { prefix: 'iVBORw0KGgo', mediaType: 'image/png' },
      { prefix: '/9j/', mediaType: 'image/jpeg' },
      { prefix: 'UklGR', mediaType: 'image/webp' },
      { prefix: 'R0lGOD', mediaType: 'image/gif' },
      // Unrecognized magic falls back to image/png.
      { prefix: 'AAAA', mediaType: 'image/png' },
    ]
    const parsed = parseResponseBody(
      JSON.stringify({
        data: cases.map((entry) => ({ b64_json: entry.prefix })),
      })
    )
    expect(parsed?.images).toEqual(
      cases.map((entry) => ({
        url: `data:${entry.mediaType};base64,${entry.prefix}`,
        mediaType: entry.mediaType,
      }))
    )
  })

  test('still returns null for embedding data envelopes', () => {
    expect(
      parseResponseBody(
        JSON.stringify({
          data: [{ object: 'embedding', embedding: [0.1, 0.2] }],
        })
      )
    ).toBeNull()
  })
})

describe('parseResponseBody — task creation', () => {
  test('parses the host fallback envelope with id and task_id', () => {
    const parsed = parseResponseBody(
      JSON.stringify({
        id: 'task_abc',
        task_id: 'task_abc',
        status: 'queued',
        model: 'doubao-seedance-2-0-mini-260615',
        created_at: 1780921157,
      })
    )
    expect(parsed?.task).toEqual({ id: 'task_abc', status: 'queued' })
    expect(parsed?.images).toBeUndefined()
  })

  test('parses the openai_video envelope that only carries id', () => {
    const parsed = parseResponseBody(
      JSON.stringify({ id: 'task_xyz', status: 'completed', model: 'm' })
    )
    expect(parsed?.task).toEqual({ id: 'task_xyz', status: 'completed' })
  })

  test('returns null for id-only or status-only payloads', () => {
    expect(parseResponseBody(JSON.stringify({ id: 'obj_1' }))).toBeNull()
    expect(parseResponseBody(JSON.stringify({ status: 'queued' }))).toBeNull()
  })
})
