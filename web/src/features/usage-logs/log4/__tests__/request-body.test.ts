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
  parseRequestBody,
  parseResponseBody,
} from '../request-body'

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

    const parsed = parseRequestBody(body)
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
    const parsed = parseRequestBody(
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

    const parsed = parseRequestBody(body)
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
    const parsed = parseRequestBody(
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

    const parsed = parseRequestBody(body)
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

    const parsed = parseRequestBody(body)
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
    const parsed = parseRequestBody(
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
    const parsed = parseRequestBody(
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
    const document = parseRequestBody(
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
    const openai = parseRequestBody(
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
