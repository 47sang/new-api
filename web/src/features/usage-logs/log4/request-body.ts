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
/**
 * Parsers that turn a stored request/response body (the raw client-facing
 * payload recorded by the request/response log feature) into a unified
 * message list for the Log4 detail dialog.
 *
 * Supported request formats: OpenAI Chat Completions, Claude Messages,
 * Gemini GenerateContent, OpenAI Responses, plus prompt-style generation
 * requests (image generation, video task creation). Supported response
 * formats are the same chat formats — both non-streaming JSON and the
 * stream-merged single object produced by the backend — plus generated
 * image payloads and async task-creation envelopes. Chat parsers return
 * null for anything else (embeddings, unrecognized SSE) so the dialog can
 * fall back to the raw view.
 */

export type Log4BodyFormat = 'openai' | 'claude' | 'gemini' | 'responses'

export type Log4Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ParsedToolCall {
  name: string
  arguments: string
}

export interface ParsedToolResult {
  id: string
  content: string
}

export interface ParsedMessage {
  role: Log4Role
  /** Plain text content, used for the list preview and the detail pane. */
  text: string
  toolCalls?: ParsedToolCall[]
  toolResults?: ParsedToolResult[]
  imageCount?: number
  /** Anthropic prompt caching: the message carries a cache_control marker. */
  cached?: boolean
  /** Original provider-specific message object, for the raw view. */
  raw: unknown
}

export interface ParsedRequest {
  format: Log4BodyFormat
  messages: ParsedMessage[]
}

/**
 * A prompt-style generation request (image generation, video task
 * creation): the API contract is a top-level `prompt` string plus
 * generation parameters, with no chat message envelope.
 */
export interface ParsedGenerationRequest {
  format: 'generation'
  /** The generation prompt text. */
  prompt: string
  /**
   * Remaining top-level request parameters (model, size, seconds, ...).
   * `truncated` marks values clipped to MAX_GENERATION_PARAM_LENGTH —
   * inline base64 payloads can be megabytes and would freeze the pane.
   * Image-carrying parameters with renderable values are moved to
   * `images` instead of staying here.
   */
  params: Array<{ key: string; value: string; truncated?: boolean }>
  /**
   * Renderable reference images extracted from the dedicated image
   * parameters (image / images / input_reference), in document order.
   * Rendered as attachment thumbnails with the same lightbox preview as
   * the output tab.
   */
  images: ParsedMessageImage[]
}

/** True when the parsed request is a generation request, not a chat one. */
export function isGenerationRequest(
  request: ParsedRequest | ParsedGenerationRequest
): request is ParsedGenerationRequest {
  return request.format === 'generation'
}

/** Relay paths that create generation tasks or images. */
const GENERATION_REQUEST_PATH_PREFIXES = [
  '/v1/images',
  '/v1/video',
  '/v1/videos',
]

/**
 * Confirm the log's recorded request path belongs to a generation endpoint
 * (image generation, video task creation, video remix). The body heuristic
 * alone cannot tell a minimal image request from a legacy /v1/completions
 * body (both may carry only n or seed), so the consume log's
 * other.request_path decides when it is present.
 *
 * @param requestPath - other.request_path of the consume log
 * @returns True when the path is a generation endpoint, or unknown (older
 *   logs without the field) so the body heuristic still applies
 */
export function matchesGenerationRequestPath(requestPath?: string): boolean {
  if (!requestPath) return true
  return GENERATION_REQUEST_PATH_PREFIXES.some((prefix) =>
    requestPath.startsWith(prefix)
  )
}

/** Audio output extracted from a response, playable through <audio>. */
export interface ParsedResponseAudio {
  /** `data:audio/<format>;base64,<data>` URI ready for an <audio> src. */
  url: string
}

/** Async task creation response (e.g. video generation submit). */
export interface ParsedResponseTask {
  /** Public task ID (`id` first, `task_id` as fallback). */
  id: string
  /** Task status reported at creation time (e.g. "queued"). */
  status?: string
}

export interface ParsedResponse {
  format: Log4BodyFormat
  /** Chain-of-thought / thinking content. */
  reasoning?: string
  /** Final answer text. */
  content?: string
  refusal?: string
  toolCalls?: ParsedToolCall[]
  /** Base64 audio payload (OpenAI chat audio output modality). */
  audio?: ParsedResponseAudio
  /** Generated images (image generation response: data[].url / b64_json). */
  images?: ParsedMessageImage[]
  /** Async task creation envelope (video generation submit response). */
  task?: ParsedResponseTask
  finishReason?: string
  error?: string
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value as UnknownRecord
  }
  return null
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

interface ContentAccumulator {
  text: string[]
  imageCount: number
  cached: boolean
}

/**
 * Normalize one content value (string or a provider-specific block array)
 * into plain text plus counters. Handles the block shapes shared by OpenAI
 * content parts and Claude/Gemini content blocks.
 */
function accumulateContent(content: unknown, acc: ContentAccumulator): void {
  if (typeof content === 'string') {
    if (content) acc.text.push(content)
    return
  }
  const blocks = asArray(content)
  if (!blocks) return
  for (const raw of blocks) {
    const block = asRecord(raw)
    if (!block) continue
    if (asRecord(block.cache_control) || block.cache_control === true) {
      acc.cached = true
    }
    const type = asString(block.type)
    const text =
      asString(block.text) ||
      asString(block.input_text) ||
      asString(block.output_text) ||
      asString(block.refusal) ||
      asString(block.content)
    if (
      type === 'image' ||
      type === 'image_url' ||
      type === 'input_image' ||
      type === 'image_file'
    ) {
      acc.imageCount += 1
      continue
    }
    if (text) acc.text.push(text)
  }
}

/** One renderable image found inside a message's raw content blocks. */
export interface ParsedMessageImage {
  /**
   * Directly embeddable URL: a `data:image/...;base64,...` URI for base64
   * payloads, or an http(s) URL. Non-renderable references (OpenAI file_id,
   * Gemini fileUri) are never collected.
   */
  url: string
  /** Declared MIME type (Claude/Gemini payloads only). */
  mediaType?: string
}

/** Guard against pathological nesting in stored bodies. */
const MAX_IMAGE_WALK_DEPTH = 8

function collectImage(
  images: ParsedMessageImage[],
  url: unknown,
  mediaType?: string
): void {
  if (typeof url !== 'string') return
  if (
    !url.startsWith('data:image/') &&
    !url.startsWith('http://') &&
    !url.startsWith('https://')
  ) {
    return
  }
  if (mediaType) {
    images.push({ url, mediaType })
  } else {
    images.push({ url })
  }
}

/**
 * Collect the renderable images of one parsed message by walking its raw
 * provider object. Understands every image shape the parsers count in
 * imageCount — OpenAI chat `image_url` parts (object or bare string),
 * Responses `input_image`, Claude `image` blocks (base64 source becomes a
 * data URI, url source passes through) and Gemini `inlineData`/
 * `inline_data` parts — and recurses into nested containers such as Claude
 * `tool_result` content. References that cannot be rendered in an
 * <img> (file ids, Gemini fileUri) are skipped, so the result may be
 * shorter than imageCount.
 *
 * @param raw - The message's provider-specific object (ParsedMessage.raw)
 * @returns Images in document order; empty when the message has none
 */
export function extractMessageImages(raw: unknown): ParsedMessageImage[] {
  const images: ParsedMessageImage[] = []
  const visit = (value: unknown, depth: number): void => {
    if (depth > MAX_IMAGE_WALK_DEPTH || value == null) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (typeof value !== 'object') return
    const record = value as UnknownRecord
    const type = asString(record.type)
    if (type === 'image_url' || type === 'input_image') {
      // OpenAI chat parts wrap the URL in an object; Responses input_image
      // carries it as a plain string.
      const container = asRecord(record.image_url)
      collectImage(images, container ? container.url : record.image_url)
      return
    }
    if (type === 'image') {
      const source = asRecord(record.source)
      if (!source) return
      if (asString(source.type) === 'base64') {
        const mediaType = asString(source.media_type) || 'image/png'
        collectImage(
          images,
          `data:${mediaType};base64,${asString(source.data)}`,
          mediaType
        )
      } else {
        collectImage(images, source.url)
      }
      return
    }
    const inline = asRecord(record.inlineData) ?? asRecord(record.inline_data)
    if (inline) {
      const mediaType =
        asString(inline.mimeType) || asString(inline.mime_type) || 'image/png'
      collectImage(
        images,
        `data:${mediaType};base64,${asString(inline.data)}`,
        mediaType
      )
      return
    }
    for (const key of Object.keys(record)) {
      visit(record[key], depth + 1)
    }
  }
  visit(raw, 0)
  return images
}

function formatToolArguments(value: unknown): string {
  if (typeof value === 'string' && value) return value
  if (value == null) return ''
  return stringifyJson(value)
}

/**
 * Extract a human-readable message from an error payload, which may be an
 * object ({message}/{code}/{type}) or a bare string — third-party relaying
 * channels are known to emit {"error":"rate limited"}.
 */
function extractErrorMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value
  const record = asRecord(value)
  if (!record) return undefined
  const text = record.message ?? record.code ?? record.type
  return text != null ? String(text) : undefined
}

/** Per-message token estimate used by the "tokens per message" chart. */
export function estimateMessageTokens(message: ParsedMessage): number {
  let chars = message.text.length
  for (const call of message.toolCalls ?? []) {
    chars += call.name.length + call.arguments.length
  }
  for (const result of message.toolResults ?? []) {
    chars += result.content.length
  }
  return Math.ceil(chars / 4)
}

function pushMessage(
  messages: ParsedMessage[],
  message: ParsedMessage & { raw?: unknown }
): void {
  if (
    !message.text &&
    !message.toolCalls?.length &&
    !message.toolResults?.length &&
    !message.imageCount
  ) {
    return
  }
  messages.push({ ...message, raw: message.raw ?? null })
}

/**
 * Best-effort flat text for a parsed message: plain text plus tool call and
 * tool result summaries. Used by the message-list preview and the search.
 */
export function messagePreview(message: ParsedMessage): string {
  if (message.text) return message.text
  const parts: string[] = []
  if (message.toolCalls?.length) {
    parts.push(message.toolCalls.map((call) => call.name).join(', '))
  }
  if (message.toolResults?.length) {
    parts.push(message.toolResults.map((result) => result.content).join('\n'))
  }
  return parts.join('\n')
}

/**
 * Normalize an OpenAI/Responses role token to the four display roles.
 * 'developer' is OpenAI's renamed system role; unknown roles are user turns.
 */
function normalizeOpenAIRole(role: string): Log4Role {
  if (role === 'system' || role === 'developer') return 'system'
  if (role === 'assistant') return 'assistant'
  if (role === 'tool') return 'tool'
  return 'user'
}

// ---------- OpenAI Chat Completions request ----------

function parseOpenAIMessages(body: UnknownRecord): ParsedMessage[] | null {
  const rawMessages = asArray(body.messages)
  if (!rawMessages) return null

  const messages: ParsedMessage[] = []
  for (const raw of rawMessages) {
    const item = asRecord(raw)
    if (!item) continue
    const role = asString(item.role) || 'user'
    const acc: ContentAccumulator = { text: [], imageCount: 0, cached: false }
    accumulateContent(item.content, acc)
    if (asString(item.refusal)) acc.text.push(asString(item.refusal))

    const toolCalls: ParsedToolCall[] = []
    const rawToolCalls = asArray(item.tool_calls)
    for (const rawCall of rawToolCalls ?? []) {
      const call = asRecord(rawCall)
      if (!call) continue
      const fn = asRecord(call.function)
      if (!fn) continue
      toolCalls.push({
        name: asString(fn.name),
        arguments: asString(fn.arguments),
      })
    }

    const normalizedRole = normalizeOpenAIRole(role)

    pushMessage(messages, {
      role: normalizedRole,
      text: acc.text.join('\n\n'),
      toolCalls: toolCalls.length ? toolCalls : undefined,
      imageCount: acc.imageCount || undefined,
      cached: acc.cached || undefined,
      raw: item,
    })
  }
  return messages
}

// ---------- Claude Messages request ----------

function parseClaudeMessages(body: UnknownRecord): ParsedMessage[] | null {
  const rawMessages = asArray(body.messages)
  if (!rawMessages) return null

  const messages: ParsedMessage[] = []

  const systemAcc: ContentAccumulator = {
    text: [],
    imageCount: 0,
    cached: false,
  }
  accumulateContent(body.system, systemAcc)
  pushMessage(messages, {
    role: 'system',
    text: systemAcc.text.join('\n\n'),
    cached: systemAcc.cached || undefined,
    raw: body.system ?? null,
  })

  for (const raw of rawMessages) {
    const item = asRecord(raw)
    if (!item) continue
    const isAssistant = asString(item.role) === 'assistant'
    const acc: ContentAccumulator = { text: [], imageCount: 0, cached: false }
    const toolCalls: ParsedToolCall[] = []
    const toolResults: ParsedToolResult[] = []

    const blocks = asArray(item.content)
    if (blocks) {
      for (const rawBlock of blocks) {
        const block = asRecord(rawBlock)
        if (!block) continue
        if (asRecord(block.cache_control) || block.cache_control === true) {
          acc.cached = true
        }
        switch (asString(block.type)) {
          case 'text':
          case 'thinking':
            if (asString(block.text) || asString(block.thinking)) {
              acc.text.push(asString(block.text) || asString(block.thinking))
            }
            break
          case 'tool_use':
            toolCalls.push({
              name: asString(block.name),
              arguments: formatToolArguments(block.input),
            })
            break
          case 'tool_result': {
            const resultAcc: ContentAccumulator = {
              text: [],
              imageCount: 0,
              cached: false,
            }
            accumulateContent(block.content, resultAcc)
            toolResults.push({
              id: asString(block.tool_use_id),
              content: resultAcc.text.join('\n\n'),
            })
            break
          }
          case 'image':
            acc.imageCount += 1
            break
          case 'document': {
            // Text documents carry their content inline; without this a
            // document-only turn would be dropped as an empty message.
            const source = asRecord(block.source)
            if (asString(source?.type) === 'text') {
              const title = asString(block.title)
              const data = asString(source?.data)
              const text = title ? `${title}\n\n${data}` : data
              if (text.trim()) acc.text.push(text)
            }
            break
          }
          default:
            break
        }
      }
    } else {
      accumulateContent(item.content, acc)
    }

    // OpenRouter-style roles: a user turn that only reports tool results is
    // displayed as the "Tool" role.
    let role: Log4Role = 'user'
    if (isAssistant) {
      role = 'assistant'
    } else if (toolResults.length > 0) {
      role = 'tool'
    }

    pushMessage(messages, {
      role,
      text: acc.text.join('\n\n'),
      toolCalls: toolCalls.length ? toolCalls : undefined,
      toolResults: toolResults.length ? toolResults : undefined,
      imageCount: acc.imageCount || undefined,
      cached: acc.cached || undefined,
      raw: item,
    })
  }
  return messages
}

// ---------- Gemini GenerateContent request ----------

function parseGeminiMessages(body: UnknownRecord): ParsedMessage[] | null {
  const contents = asArray(body.contents)
  if (!contents) return null

  const messages: ParsedMessage[] = []

  const systemAcc: ContentAccumulator = {
    text: [],
    imageCount: 0,
    cached: false,
  }
  accumulateContent(
    asRecord(body.systemInstruction)?.parts ?? body.systemInstruction,
    systemAcc
  )
  pushMessage(messages, {
    role: 'system',
    text: systemAcc.text.join('\n\n'),
    raw: body.systemInstruction ?? null,
  })

  for (const raw of contents) {
    const item = asRecord(raw)
    if (!item) continue
    const acc: ContentAccumulator = { text: [], imageCount: 0, cached: false }
    const toolCalls: ParsedToolCall[] = []
    const toolResults: ParsedToolResult[] = []

    for (const rawPart of asArray(item.parts) ?? []) {
      const part = asRecord(rawPart)
      if (!part) continue
      if (asString(part.text)) acc.text.push(asString(part.text))
      if (part.inlineData || part.fileData) acc.imageCount += 1
      const fnCall = asRecord(part.functionCall)
      if (fnCall) {
        toolCalls.push({
          name: asString(fnCall.name),
          arguments: formatToolArguments(fnCall.args),
        })
      }
      const fnResponse = asRecord(part.functionResponse)
      if (fnResponse) {
        toolResults.push({
          id: asString(fnResponse.name),
          content: formatToolArguments(fnResponse.response),
        })
      }
    }

    pushMessage(messages, {
      role: asString(item.role) === 'model' ? 'assistant' : 'user',
      text: acc.text.join('\n\n'),
      toolCalls: toolCalls.length ? toolCalls : undefined,
      toolResults: toolResults.length ? toolResults : undefined,
      imageCount: acc.imageCount || undefined,
      raw: item,
    })
  }
  return messages
}

// ---------- OpenAI Responses request ----------

function parseResponsesMessages(body: UnknownRecord): ParsedMessage[] | null {
  const input = body.input
  if (typeof input !== 'string' && !Array.isArray(input)) return null

  const messages: ParsedMessage[] = []

  const instructionsAcc: ContentAccumulator = {
    text: [],
    imageCount: 0,
    cached: false,
  }
  accumulateContent(body.instructions, instructionsAcc)
  pushMessage(messages, {
    role: 'system',
    text: instructionsAcc.text.join('\n\n'),
    raw: body.instructions ?? null,
  })

  if (typeof input === 'string') {
    pushMessage(messages, { role: 'user', text: input, raw: input })
    return messages
  }

  for (const raw of input) {
    const item = asRecord(raw)
    if (!item) continue
    const acc: ContentAccumulator = { text: [], imageCount: 0, cached: false }
    const toolCalls: ParsedToolCall[] = []
    const toolResults: ParsedToolResult[] = []

    const itemType = asString(item.type)
    if (itemType === 'function_call') {
      toolCalls.push({
        name: asString(item.name),
        arguments: asString(item.arguments),
      })
    } else if (itemType === 'function_call_output') {
      toolResults.push({
        id: asString(item.call_id),
        content: asString(item.output),
      })
    } else {
      accumulateContent(item.content, acc)
    }

    let normalizedRole = normalizeOpenAIRole(asString(item.role))
    if (itemType === 'function_call') {
      // A function_call item is the model's own action, not a user turn.
      normalizedRole = 'assistant'
    } else if (
      itemType === 'function_call_output' ||
      asString(item.role) === 'tool'
    ) {
      normalizedRole = 'tool'
    }

    pushMessage(messages, {
      role: normalizedRole,
      text: acc.text.join('\n\n'),
      toolCalls: toolCalls.length ? toolCalls : undefined,
      toolResults: toolResults.length ? toolResults : undefined,
      imageCount: acc.imageCount || undefined,
      raw: item,
    })
  }
  return messages
}

/**
 * Tell Claude Messages requests apart from OpenAI Chat requests: both carry a
 * top-level `messages` array, and both may set a `system`-like field, so the
 * per-message shapes decide. OpenAI-only markers (tool_calls, tool/developer
 * roles, input_text/image_url parts) force the OpenAI parser even when a
 * `system` field is present; Claude-only block types force the Claude parser.
 * Plain-text-only bodies without `system` parse identically through the
 * OpenAI path (same roles, same text), so the remaining ambiguity is harmless.
 */
function looksLikeClaudeRequest(record: UnknownRecord): boolean {
  const CLAUDE_ONLY_BLOCKS = new Set([
    'tool_use',
    'tool_result',
    'thinking',
    'document',
  ])
  const OPENAI_ONLY_BLOCKS = new Set([
    'input_text',
    'output_text',
    'image_url',
    'image_file',
    'input_image',
  ])
  for (const raw of asArray(record.messages) ?? []) {
    const item = asRecord(raw)
    if (!item) continue
    if (asArray(item.tool_calls) || item.function_call !== undefined) {
      return false
    }
    const role = asString(item.role)
    if (role === 'tool' || role === 'developer') {
      return false
    }
    for (const rawBlock of asArray(item.content) ?? []) {
      const type = asString(asRecord(rawBlock)?.type)
      if (CLAUDE_ONLY_BLOCKS.has(type)) return true
      if (OPENAI_ONLY_BLOCKS.has(type)) return false
    }
  }
  return record.system !== undefined
}

/**
 * Parameter keys that only generation-style requests carry (image
 * generation, video task creation). A prompt-only body with none of these
 * is not claimed by the generation parser.
 */
const GENERATION_PARAM_KEYS = new Set([
  // OpenAI images: /v1/images/generations
  'size',
  'n',
  'quality',
  'response_format',
  'watermark',
  'style',
  'background',
  'moderation',
  'output_format',
  'output_compression',
  'partial_images',
  // Video task submit (TaskSubmitReq)
  'seconds',
  'duration',
  'image',
  'images',
  'input_reference',
  'metadata',
  'width',
  'height',
  'fps',
  'seed',
  'resolution',
  'ratio',
  'mode',
])

/**
 * Generation parameter keys whose values carry reference images (video
 * task submit: a URL string, an array of them, or an inline base64/data
 * URI payload). Values yielding at least one renderable image are pulled
 * out of `params` and shown as attachment thumbnails instead.
 */
const GENERATION_IMAGE_PARAM_KEYS = new Set([
  'image',
  'images',
  'input_reference',
])

/**
 * Parameter keys of the legacy /v1/completions endpoint, which also sends a
 * top-level `prompt`. Those requests keep falling through to the unparsed
 * view instead of being presented as generation prompts.
 */
const COMPLETIONS_ONLY_KEYS = new Set([
  'max_tokens',
  'max_completion_tokens',
  'temperature',
  'top_p',
  'echo',
  'stop',
  'suffix',
  'logprobs',
  'best_of',
  'logit_bias',
  'presence_penalty',
  'frequency_penalty',
])

/** Render one generation request parameter for the params list. */
function formatGenerationParamValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value == null) return 'null'
  return stringifyJson(value)
}

/**
 * Length at which a generation parameter value is clipped for display.
 * Inline base64 reference images run to megabytes; the full content stays
 * available on the raw tab.
 */
const MAX_GENERATION_PARAM_LENGTH = 2000

/**
 * Collect the renderable images of one generation image-parameter value:
 * a URL/data-URI string, an array of such values, or an object carrying
 * `b64_json` / `url` (the payload shapes the response side accepts).
 * collectImage skips non-renderable references (file ids), so a value
 * holding none leaves the parameter as a plain text entry.
 */
function collectGenerationParamImages(
  value: unknown,
  images: ParsedMessageImage[],
  depth: number
): void {
  if (depth > MAX_IMAGE_WALK_DEPTH || value == null) return
  if (typeof value === 'string') {
    collectImage(images, value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectGenerationParamImages(item, images, depth + 1)
    }
    return
  }
  const record = asRecord(value)
  if (!record) return
  const b64 = asString(record.b64_json)
  if (b64) {
    const mediaType = sniffImageMediaType(b64)
    collectImage(images, `data:${mediaType};base64,${b64}`, mediaType)
    return
  }
  collectImage(images, record.url)
}

/**
 * Parse a prompt-style generation request body (image generation, video
 * task creation): a top-level string `prompt`, no chat envelope
 * (messages/contents/input), at least one generation parameter, and no
 * legacy-completions parameter.
 *
 * @param record - Parsed JSON request body
 * @returns The prompt with the remaining parameters, or null when the body
 *   is not a recognizable generation request
 */
function parseGenerationRequest(
  record: UnknownRecord
): ParsedGenerationRequest | null {
  const prompt = record.prompt
  if (typeof prompt !== 'string' || !prompt) return null
  if (
    asArray(record.messages) ||
    asArray(record.contents) ||
    record.input !== undefined
  ) {
    return null
  }
  let hasGenerationParam = false
  for (const key of Object.keys(record)) {
    if (COMPLETIONS_ONLY_KEYS.has(key)) return null
    if (GENERATION_PARAM_KEYS.has(key)) hasGenerationParam = true
  }
  if (!hasGenerationParam) return null
  const images: ParsedMessageImage[] = []
  const params: ParsedGenerationRequest['params'] = []
  for (const key of Object.keys(record)) {
    if (key === 'prompt') continue
    // Image-carrying parameters render as attachment thumbnails; a value
    // with no renderable image (e.g. a file id) stays a text parameter.
    if (GENERATION_IMAGE_PARAM_KEYS.has(key)) {
      const before = images.length
      collectGenerationParamImages(record[key], images, 0)
      if (images.length > before) continue
    }
    const value = formatGenerationParamValue(record[key])
    // Inline base64 payloads (reference images inside metadata blobs)
    // reach megabytes; clip them so rendering the params card stays cheap.
    if (value.length > MAX_GENERATION_PARAM_LENGTH) {
      params.push({
        key,
        value: value.slice(0, MAX_GENERATION_PARAM_LENGTH),
        truncated: true,
      })
    } else {
      params.push({ key, value })
    }
  }
  return { format: 'generation', prompt, params, images }
}

/**
 * Parse a stored request body into a unified message list, or a
 * generation request for prompt-style bodies.
 *
 * @param body - Raw request_body string as stored in request_response_logs
 * @returns Parsed chat messages / generation request, or null when the
 *   body is not a supported request (invalid JSON, embeddings, multipart
 *   placeholder, ...)
 */
export function parseRequestBody(
  body: string
): ParsedRequest | ParsedGenerationRequest | null {
  if (!body) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  const record = asRecord(parsed)
  if (!record) return null

  if (asArray(record.contents)) {
    const messages = parseGeminiMessages(record)
    return messages ? { format: 'gemini', messages } : null
  }
  if (record.input !== undefined) {
    const messages = parseResponsesMessages(record)
    return messages ? { format: 'responses', messages } : null
  }
  if (asArray(record.messages)) {
    if (looksLikeClaudeRequest(record)) {
      const messages = parseClaudeMessages(record)
      return messages ? { format: 'claude', messages } : null
    }
    const messages = parseOpenAIMessages(record)
    return messages ? { format: 'openai', messages } : null
  }
  return parseGenerationRequest(record)
}

// ---------- Response parsing ----------

/**
 * MIME types for the audio formats a response may declare explicitly.
 * pcm16 is raw headerless PCM — no browser <audio> can play it, the
 * honest type at least makes that visible instead of guessing wrong.
 */
const AUDIO_FORMAT_MEDIA_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  pcm16: 'audio/pcm',
}

/**
 * Base64 prefixes identifying audio containers by their file magic.
 * base64 maps 3 bytes to 4 characters, so each prefix is an exact byte
 * signature: RIFF (WAV), OggS (Opus speech) and fLaC.
 */
const AUDIO_DATA_PREFIXES: Array<[prefix: string, mediaType: string]> = [
  ['UklGR', 'audio/wav'],
  ['T2dnU', 'audio/ogg'],
  ['ZkxhQ', 'audio/flac'],
]

/**
 * ADTS AAC frames open with the 12-bit sync 0xFF followed by one of four
 * second bytes (0xF1/0xF0/0xF9/0xF8 = MPEG-4/2 × CRC/no-CRC). base64 '//'
 * forces the first byte pair to 0xFF 0xF*, and the third character covers
 * exactly those four headers (A-H, g-n); every other MPEG audio frame
 * (MP3) lands on a third character outside that range and falls through
 * to the audio/mpeg fallback.
 */
const ADTS_AAC_PREFIX = /^\/\/[A-Hg-n]/

/**
 * Build a playable data URI from an audio output payload.
 *
 * The OpenAI chat audio object carries no format field (the format is a
 * request-side parameter), so an explicitly declared format wins, then the
 * base64 magic bytes are sniffed, and anything unrecognized falls back to
 * audio/mpeg — raw MPEG audio frames (MP3) decode fine as mpeg, while
 * genuinely headerless payloads (raw pcm) cannot be played by any browser
 * anyway.
 *
 * @param data - Base64 audio payload as stored in the response body
 * @param format - Optional format string the payload declared
 * @returns A `data:audio/...;base64,...` URI for an <audio controls> src
 */
function buildAudioDataUri(data: string, format: string): ParsedResponseAudio {
  let mediaType = AUDIO_FORMAT_MEDIA_TYPES[format]
  if (!mediaType) {
    for (const [prefix, magicType] of AUDIO_DATA_PREFIXES) {
      if (data.startsWith(prefix)) {
        mediaType = magicType
        break
      }
    }
  }
  if (!mediaType && ADTS_AAC_PREFIX.test(data)) mediaType = 'audio/aac'
  if (!mediaType) mediaType = 'audio/mpeg'
  return { url: `data:${mediaType};base64,${data}` }
}

/**
 * Base64 prefixes identifying image containers by their file magic,
 * verified byte-exact: PNG (8-byte header), JPEG (FF D8 FF), RIFF (WEBP)
 * and GIF8 (GIF87a/89a share the 6-byte encoding prefix "R0lGOD").
 */
const IMAGE_DATA_PREFIXES: Array<[prefix: string, mediaType: string]> = [
  ['iVBORw0KGgo', 'image/png'],
  ['/9j/', 'image/jpeg'],
  ['UklGR', 'image/webp'],
  ['R0lGOD', 'image/gif'],
]

/**
 * Sniff the MIME type of a base64 image payload by its magic bytes.
 * Generation APIs do not echo an output format on the response, so the
 * bytes decide; an unrecognized payload claims image/png.
 */
function sniffImageMediaType(data: string): string {
  for (const [prefix, mediaType] of IMAGE_DATA_PREFIXES) {
    if (data.startsWith(prefix)) return mediaType
  }
  return 'image/png'
}

/**
 * Collect the renderable images of an image-generation response body
 * (`data[]` items): `b64_json` payloads become data URIs with a sniffed
 * MIME type, `url` entries pass through collectImage so non-renderable
 * values are skipped.
 */
function collectGenerationImages(data: unknown[]): ParsedMessageImage[] {
  const images: ParsedMessageImage[] = []
  for (const raw of data) {
    const item = asRecord(raw)
    if (!item) continue
    const b64 = asString(item.b64_json)
    if (b64) {
      const mediaType = sniffImageMediaType(b64)
      images.push({
        url: `data:${mediaType};base64,${b64}`,
        mediaType,
      })
      continue
    }
    collectImage(images, item.url)
  }
  return images
}

/**
 * Recognize an async task-creation response (video generation submit):
 * a public task id (`id` first, `task_id` fallback — the host fallback
 * shape carries both, the pinned /v1/videos shape only `id`) plus a
 * status field, with none of the chat response markers.
 */
function parseTaskCreationResponse(
  record: UnknownRecord
): ParsedResponseTask | null {
  const id = asString(record.id) || asString(record.task_id)
  const status = asString(record.status)
  if (!id || !status) return null
  return { id, status }
}

function parseOpenAIResponse(record: UnknownRecord): ParsedResponse {
  const result: ParsedResponse = { format: 'openai' }
  const errorMessage = extractErrorMessage(record.error)
  if (errorMessage) result.error = errorMessage
  const choice = asRecord(asArray(record.choices)?.[0])
  if (!choice) return result
  const message = asRecord(choice.message)
  if (message) {
    result.content = asString(message.content) || undefined
    result.reasoning =
      asString(message.reasoning_content) ||
      asString(message.reasoning) ||
      undefined
    result.refusal = asString(message.refusal) || undefined
    const toolCalls: ParsedToolCall[] = []
    for (const rawCall of asArray(message.tool_calls) ?? []) {
      const call = asRecord(rawCall)
      const fn = asRecord(call?.function)
      if (fn) {
        toolCalls.push({
          name: asString(fn.name),
          arguments: asString(fn.arguments),
        })
      }
    }
    // Legacy non-stream shape still emitted by some relaying channels.
    const legacyCall = asRecord(message.function_call)
    if (legacyCall) {
      toolCalls.push({
        name: asString(legacyCall.name),
        arguments: asString(legacyCall.arguments),
      })
    }
    if (toolCalls.length) result.toolCalls = toolCalls
    // Audio output modality: the base64 payload becomes a playable data URI
    // and the spoken text keeps flowing into content as the transcript.
    const audioRecord = asRecord(message.audio)
    const audioData = asString(audioRecord?.data)
    if (audioData) {
      result.audio = buildAudioDataUri(audioData, asString(audioRecord?.format))
    }
    const transcript = asString(asRecord(message.audio)?.transcript)
    if (transcript) {
      result.content = [result.content, transcript].filter(Boolean).join('\n\n')
    }
  }
  result.finishReason = asString(choice.finish_reason) || undefined
  return result
}

function parseClaudeResponse(record: UnknownRecord): ParsedResponse {
  const result: ParsedResponse = { format: 'claude' }
  const errorMessage = extractErrorMessage(record.error)
  if (errorMessage) result.error = errorMessage
  const reasoning: string[] = []
  const content: string[] = []
  const toolCalls: ParsedToolCall[] = []
  for (const rawBlock of asArray(record.content) ?? []) {
    const block = asRecord(rawBlock)
    if (!block) continue
    switch (asString(block.type)) {
      case 'thinking':
        if (asString(block.thinking)) reasoning.push(asString(block.thinking))
        break
      case 'text':
        if (asString(block.text)) content.push(asString(block.text))
        break
      case 'tool_use':
        toolCalls.push({
          name: asString(block.name),
          arguments: formatToolArguments(block.input),
        })
        break
      default:
        break
    }
  }
  result.reasoning = reasoning.join('\n\n') || undefined
  result.content = content.join('\n\n') || undefined
  if (toolCalls.length) result.toolCalls = toolCalls
  result.finishReason = asString(record.stop_reason) || undefined
  return result
}

function parseGeminiResponse(record: UnknownRecord): ParsedResponse {
  const result: ParsedResponse = { format: 'gemini' }
  const candidate = asRecord(asArray(record.candidates)?.[0])
  if (!candidate) {
    const feedback = asRecord(record.promptFeedback)
    const blockReason = asString(feedback?.blockReason)
    if (blockReason) result.error = blockReason
    return result
  }
  const reasoning: string[] = []
  const content: string[] = []
  const toolCalls: ParsedToolCall[] = []
  for (const rawPart of asArray(asRecord(candidate.content)?.parts) ?? []) {
    const part = asRecord(rawPart)
    if (!part) continue
    const fnCall = asRecord(part.functionCall)
    if (fnCall) {
      toolCalls.push({
        name: asString(fnCall.name),
        arguments: formatToolArguments(fnCall.args),
      })
    }
    if (!asString(part.text)) continue
    if (part.thought === true) reasoning.push(asString(part.text))
    else content.push(asString(part.text))
  }
  result.reasoning = reasoning.join('\n\n') || undefined
  result.content = content.join('\n\n') || undefined
  if (toolCalls.length) result.toolCalls = toolCalls
  result.finishReason = asString(candidate.finishReason) || undefined
  return result
}

function parseResponsesResponse(record: UnknownRecord): ParsedResponse {
  const result: ParsedResponse = { format: 'responses' }
  if (asString(record.output_text)) {
    result.content = asString(record.output_text)
  }
  const reasoning: string[] = []
  const content: string[] = []
  const toolCalls: ParsedToolCall[] = []
  for (const rawItem of asArray(record.output) ?? []) {
    const item = asRecord(rawItem)
    if (!item) continue
    switch (asString(item.type)) {
      case 'reasoning':
        for (const rawSummary of asArray(item.summary) ?? []) {
          const summary = asRecord(rawSummary)
          if (summary && asString(summary.text)) {
            reasoning.push(asString(summary.text))
          }
        }
        break
      case 'message':
        for (const rawPart of asArray(item.content) ?? []) {
          const part = asRecord(rawPart)
          if (part && asString(part.text)) content.push(asString(part.text))
        }
        break
      case 'function_call':
        toolCalls.push({
          name: asString(item.name),
          arguments: asString(item.arguments),
        })
        break
      default:
        break
    }
  }
  result.reasoning = reasoning.join('\n\n') || undefined
  if (content.length) result.content = content.join('\n\n')
  if (toolCalls.length) result.toolCalls = toolCalls
  const errorMessage = extractErrorMessage(record.error)
  if (errorMessage) result.error = errorMessage
  if (asString(record.status) === 'failed' && !result.error) {
    result.error = 'failed'
  }
  result.finishReason = asString(record.status) || undefined
  return result
}

/**
 * Parse a stored response body into reasoning/content/tool calls, generated
 * images, or an async task-creation envelope.
 *
 * @param body - Raw response_body string (JSON, or stream-merged JSON);
 *   non-JSON payloads (raw unmerged SSE, binary placeholders) yield null so
 *   the caller shows the raw view
 */
export function parseResponseBody(body: string): ParsedResponse | null {
  if (!body) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    // Raw SSE payloads (unrecognized stream format) are not parseable either.
    return null
  }
  const record = asRecord(parsed)
  if (!record) return null

  if (asArray(record.choices)) return parseOpenAIResponse(record)
  if (asArray(record.candidates)) return parseGeminiResponse(record)
  if (asArray(record.output) || record.output_text !== undefined) {
    return parseResponsesResponse(record)
  }
  if (asString(record.type) === 'message' || asArray(record.content)) {
    return parseClaudeResponse(record)
  }
  // Image-generation response: data[] items carrying url / b64_json.
  // Embeddings share the data[] envelope but carry neither key, so they
  // still fall through to null.
  const dataItems = asArray(record.data)
  if (dataItems) {
    const images = collectGenerationImages(dataItems)
    if (images.length) {
      const result: ParsedResponse = { format: 'openai', images }
      const errorMessage = extractErrorMessage(record.error)
      if (errorMessage) result.error = errorMessage
      return result
    }
  }
  // Async task-creation response (video generation submit).
  const task = parseTaskCreationResponse(record)
  if (task) {
    return { format: 'openai', task }
  }
  // Bare error payloads ({"error": "rate limited"} or {"error": {...}})
  // carry no format marker; the format field is not rendered when only an
  // error is present.
  const errorMessage = extractErrorMessage(record.error)
  if (errorMessage) {
    return { format: 'openai', error: errorMessage }
  }
  return null
}
