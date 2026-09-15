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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')

const { getRequestResponseByLogId, getSelfRequestResponseByRequestId } =
  await import('../../api')
const { Log4DetailDialog } = await import('../log4-detail-dialog')
const { resolveDetailTab } = await import('../lib')

vi.mock('../../api', () => ({
  getRequestResponseByLogId: vi.fn(),
  getSelfRequestResponseByRequestId: vi.fn(),
}))

vi.mock('@/lib/lobe-icon', () => ({
  getLobeIcon: () => null,
}))

const mockedAdminFetch = vi.mocked(getRequestResponseByLogId)
const mockedSelfFetch = vi.mocked(getSelfRequestResponseByRequestId)

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

function buildLog(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 42,
    user_id: 1,
    created_at: 1700000000,
    type: 2,
    content: '',
    username: 'alice',
    token_name: 'key',
    model_name: 'gpt-4o',
    quota: 10,
    prompt_tokens: 100,
    completion_tokens: 8,
    use_time: 2,
    is_stream: true,
    channel: 7,
    channel_name: '',
    token_id: 1,
    group: 'default',
    ip: '',
    other: '',
    request_id: 'req-abc',
    upstream_request_id: '',
    ...overrides,
  }
}

const OPENAI_REQUEST_BODY = JSON.stringify({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is the weather today?' },
    { role: 'assistant', content: 'It is sunny.' },
  ],
})

const OPENAI_RESPONSE_BODY = JSON.stringify({
  choices: [
    {
      message: {
        role: 'assistant',
        content: 'It is sunny.',
        reasoning_content: 'The user asked about weather.',
      },
      finish_reason: 'stop',
    },
  ],
})

function asResult(data: unknown) {
  return { success: true, message: '', data: data as never }
}

function renderDialog(props: {
  log: Record<string, unknown> | null
  isAdmin: boolean
  initialTab?: 'input' | 'output' | 'raw'
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <Log4DetailDialog
          log={props.log as never}
          isAdmin={props.isAdmin}
          open={props.log != null}
          initialTab={props.initialTab}
          onOpenChange={() => {}}
        />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

beforeEach(() => {
  mockedAdminFetch.mockReset()
  mockedSelfFetch.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('Log4DetailDialog', () => {
  test('renders the message browser and shows the selected message content', async () => {
    mockedAdminFetch.mockResolvedValue(
      asResult({
        id: 1,
        request_id: 'req-abc',
        request_body: OPENAI_REQUEST_BODY,
        response_body: OPENAI_RESPONSE_BODY,
        is_stream: true,
        is_completed: true,
        response_size: 300,
        status_code: 200,
        created_at: 1700000000,
      })
    )
    const user = userEvent.setup()
    renderDialog({ log: buildLog({}), isAdmin: true })

    // Header shows the message count and input tokens. The title renders as
    // several sibling text nodes, so match on aggregated textContent.
    await waitFor(() => {
      expect(
        screen.getAllByText((_, el) =>
          Boolean(el?.textContent?.includes('3 messages'))
        ).length
      ).toBeGreaterThan(0)
    })
    // Message list renders all three parsed messages with previews; each
    // preview text also appears in the detail pane (td ancestors share the
    // same textContent), so all assertions must tolerate multiple hits.
    expect(
      screen.getAllByText((_, el) =>
        Boolean(el?.textContent?.includes('You are a helpful assistant.'))
      ).length
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText('What is the weather today?').length
    ).toBeGreaterThan(0)
    // The first message is selected by default and shown in the detail pane
    expect(screen.getByText('Message 1 of 3')).toBeInTheDocument()

    // Clicking the second message shows its full content on the right
    await user.click(screen.getAllByText('What is the weather today?')[0])
    await waitFor(() => {
      expect(screen.getAllByText('What is the weather today?').length).toBe(2)
    })
    // Admin path fetches by log id
    expect(mockedAdminFetch).toHaveBeenCalledWith(42, true)
  })

  test('fetches by request_id for non-admin viewers', async () => {
    mockedSelfFetch.mockResolvedValue(
      asResult({
        id: 1,
        request_id: 'req-abc',
        request_body: OPENAI_REQUEST_BODY,
        response_body: OPENAI_RESPONSE_BODY,
        is_stream: false,
        is_completed: true,
        response_size: 300,
        status_code: 200,
        created_at: 1700000000,
      })
    )
    renderDialog({ log: buildLog({}), isAdmin: false })

    await waitFor(() => expect(mockedSelfFetch).toHaveBeenCalledWith('req-abc'))
    expect(mockedAdminFetch).not.toHaveBeenCalled()
  })

  test('shows reasoning and the final answer on the output tab', async () => {
    mockedAdminFetch.mockResolvedValue(
      asResult({
        id: 1,
        request_id: 'req-abc',
        request_body: OPENAI_REQUEST_BODY,
        response_body: OPENAI_RESPONSE_BODY,
        is_stream: true,
        is_completed: true,
        response_size: 300,
        status_code: 200,
        created_at: 1700000000,
      })
    )
    const user = userEvent.setup()
    renderDialog({ log: buildLog({}), isAdmin: true })

    await waitFor(() => {
      expect(
        screen.getAllByText((_, el) =>
          Boolean(el?.textContent?.includes('3 messages'))
        ).length
      ).toBeGreaterThan(0)
    })
    await user.click(screen.getByRole('button', { name: 'Output' }))

    // Thinking (chain-of-thought) and the final answer are both rendered
    expect(screen.getByText('Thinking')).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.getByText('The user asked about weather.')
      ).toBeInTheDocument()
    )
    expect(screen.getByText('Output Result')).toBeInTheDocument()
    // The finish reason from the parsed response is displayed
    expect(screen.getByText('stop')).toBeInTheDocument()
  })

  test('falls back to the raw view when the request is not a chat request', async () => {
    mockedAdminFetch.mockResolvedValue(
      asResult({
        id: 1,
        request_id: 'req-abc',
        // A body with no messages/contents/input marker cannot be parsed.
        request_body: '{"model":"tts-1","voice":"alloy"}',
        response_body: '',
        is_stream: false,
        is_completed: true,
        response_size: 10,
        status_code: 200,
        created_at: 1700000000,
      })
    )
    const user = userEvent.setup()
    renderDialog({ log: buildLog({}), isAdmin: true })

    await waitFor(() =>
      expect(
        screen.getByText('Unable to parse this request as a chat request.')
      ).toBeInTheDocument()
    )
    await user.click(screen.getByRole('button', { name: 'View raw' }))
    expect(screen.getByText('Request Body')).toBeInTheDocument()
  })

  test('shows an error state with retry when the fetch fails', async () => {
    mockedAdminFetch.mockRejectedValue(new Error('backend exploded'))
    renderDialog({ log: buildLog({}), isAdmin: true })

    await waitFor(() =>
      expect(screen.getByText('backend exploded')).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  test('selects the matching message when a chart bar is clicked', async () => {
    mockedAdminFetch.mockResolvedValue(
      asResult({
        id: 1,
        request_id: 'req-abc',
        request_body: OPENAI_REQUEST_BODY,
        response_body: OPENAI_RESPONSE_BODY,
        is_stream: true,
        is_completed: true,
        response_size: 300,
        status_code: 200,
        created_at: 1700000000,
      })
    )
    const user = userEvent.setup()
    renderDialog({ log: buildLog({}), isAdmin: true })

    // Wait for the chart bars to render
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /#2 User/ })
      ).toBeInTheDocument()
    })
    // Click the third bar -> the third message is selected and shown
    await user.click(screen.getByRole('button', { name: /#3 Assistant/ }))
    expect(screen.getByText('Message 3 of 3')).toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.getAllByText((_, el) =>
          Boolean(el?.textContent?.includes('It is sunny.'))
        ).length
      ).toBeGreaterThan(0)
    })
  })

  test('opens on the output tab when initialTab is output', async () => {
    mockedAdminFetch.mockResolvedValue(
      asResult({
        id: 1,
        request_id: 'req-abc',
        request_body: OPENAI_REQUEST_BODY,
        response_body: OPENAI_RESPONSE_BODY,
        is_stream: true,
        is_completed: true,
        response_size: 300,
        status_code: 200,
        created_at: 1700000000,
      })
    )
    renderDialog({ log: buildLog({}), isAdmin: true, initialTab: 'output' })

    // The output tab content is visible without clicking any tab
    await waitFor(() =>
      expect(screen.getByText('Thinking')).toBeInTheDocument()
    )
    await waitFor(() =>
      expect(screen.getByText('Output Result')).toBeInTheDocument()
    )
  })

  test('maps the output column to the output tab and other columns to input', () => {
    expect(resolveDetailTab('completion_tokens')).toBe('output')
    expect(resolveDetailTab('prompt_tokens')).toBe('input')
    expect(resolveDetailTab('model_name')).toBe('input')
    expect(resolveDetailTab(null)).toBe('input')
  })

  test('explains missing request_id for non-admin viewers', async () => {
    renderDialog({ log: buildLog({ request_id: '' }), isAdmin: false })

    await waitFor(() =>
      expect(
        screen.getByText('No request ID is associated with this log')
      ).toBeInTheDocument()
    )
    expect(mockedSelfFetch).not.toHaveBeenCalled()
  })

  test('previews base64 message images from the input pane thumbnails', async () => {
    mockedAdminFetch.mockResolvedValue(
      asResult({
        id: 1,
        request_id: 'req-abc',
        request_body: JSON.stringify({
          model: 'claude-sonnet-4',
          system: 'you are helpful',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What is in this picture?' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'AAAA',
                  },
                },
              ],
            },
          ],
        }),
        response_body: OPENAI_RESPONSE_BODY,
        is_stream: false,
        is_completed: true,
        response_size: 300,
        status_code: 200,
        created_at: 1700000000,
      })
    )
    const user = userEvent.setup()
    renderDialog({ log: buildLog({}), isAdmin: true })

    // The system turn is selected first; select the user turn that carries
    // the image before looking for the thumbnail.
    await waitFor(() => {
      expect(
        screen.getAllByText((_, el) =>
          Boolean(el?.textContent?.includes('2 messages'))
        ).length
      ).toBeGreaterThan(0)
    })
    await user.click(screen.getAllByText('What is in this picture?')[0])

    // The parsed image shows up as a clickable thumbnail in the detail pane
    const thumbnail = await screen.findByRole('button', {
      name: 'Open image 1 of 1',
    })
    await user.click(thumbnail)

    // The fullscreen preview opens on top of the detail dialog and shows
    // the decoded data URI
    await waitFor(() => {
      expect(
        screen.getByRole('img', { name: 'Image Preview' })
      ).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    })

    // Escape closes only the preview; the detail pane keeps its thumbnail
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('img', { name: 'Image Preview' })).toBeNull()
    })
    expect(thumbnail).toBeInTheDocument()
  })

  test('renders a generation prompt view instead of the chat fallback', async () => {
    mockedAdminFetch.mockResolvedValue(
      asResult({
        id: 1,
        request_id: 'req-abc',
        request_body: JSON.stringify({
          model: 'doubao-seedream-5.0-lite',
          prompt: 'A character sheet, 4 views',
          response_format: 'url',
          watermark: false,
          size: '2K',
        }),
        response_body: '',
        is_stream: false,
        is_completed: true,
        response_size: 10,
        status_code: 200,
        created_at: 1700000000,
      })
    )
    renderDialog({ log: buildLog({}), isAdmin: true })

    // The prompt text and the parameters are shown on the input tab…
    await waitFor(() =>
      expect(screen.getByText('A character sheet, 4 views')).toBeInTheDocument()
    )
    expect(screen.getByText('Parameters')).toBeInTheDocument()
    expect(screen.getByText('response_format')).toBeInTheDocument()
    expect(screen.getByText('url')).toBeInTheDocument()
    // …and the unparsable-chat-request fallback never appears.
    expect(
      screen.queryByText('Unable to parse this request as a chat request.')
    ).not.toBeInTheDocument()
    // Generation requests carry no message-count subtitle.
    expect(
      screen.queryByText((_, el) =>
        Boolean(el?.textContent?.includes('messages'))
      )
    ).toBeNull()
  })

  test('stacks the video generation input vertically and folds long parameters', async () => {
    const videoPrompt = 'You are a professional video director.'
    mockedAdminFetch.mockResolvedValue(
      asResult({
        id: 1,
        request_id: 'req-abc',
        request_body: JSON.stringify({
          model: 'doubao-seedance-2-0-mini-260615',
          prompt: videoPrompt,
          seconds: 7,
          image: `data:image/png;base64,${'A'.repeat(3000)}`,
          metadata: {
            content: [{ type: 'text', text: videoPrompt }],
            payload: 'B'.repeat(3000),
          },
        }),
        response_body: '',
        is_stream: false,
        is_completed: true,
        response_size: 10,
        status_code: 200,
        created_at: 1700000000,
      })
    )
    renderDialog({
      log: buildLog({ model_name: 'doubao-seedance-2-0-mini-260615' }),
      isAdmin: true,
    })

    await waitFor(() =>
      expect(screen.getByText(videoPrompt)).toBeInTheDocument()
    )

    // Vertical stack: the model/cost stat card first, then the parameter
    // area, then the prompt block (the prompt block is located through its
    // <pre>, since the dialog title reads "Prompt" too).
    const promptPre = screen.getByText(
      (_, element) =>
        element?.tagName === 'PRE' &&
        (element.textContent ?? '') === videoPrompt
    )
    const modelStat = screen.getByText('Model')
    const paramsLabel = screen.getByText('Parameters')
    expect(
      modelStat.compareDocumentPosition(paramsLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      paramsLabel.compareDocumentPosition(promptPre) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    // Both blocks hang directly off the same vertical-stack root; linear
    // order alone cannot tell a two-column grid from a vertical stack.
    const promptBlockRoot =
      promptPre.parentElement?.parentElement?.parentElement
    expect(modelStat.closest('div')?.parentElement?.parentElement).toBe(
      promptBlockRoot
    )

    // Same-value request model: the billed model shows once in the stat
    // card and the model key does not repeat as a parameter row.
    expect(
      screen.getByText('doubao-seedance-2-0-mini-260615')
    ).toBeInTheDocument()
    expect(screen.queryByText('model')).toBeNull()

    // The long metadata JSON renders as its own collapsible <pre> block
    // instead of a single-line value squeezed into a stat row.
    const metadataPre = screen.getByText(
      (_, element) =>
        element?.tagName === 'PRE' &&
        (element.textContent ?? '').includes('"content"')
    )
    expect(metadataPre).toBeInTheDocument()

    // Clipped metadata keeps the truncation hint under its block and is
    // height-capped with an Expand toggle instead of sprawling.
    expect(
      screen.getByText(/truncated — check the raw tab for the full value/)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument()

    // The inline base64 reference image renders as an attachment thumbnail
    // (clickable for the output-tab-style lightbox) instead of a clipped
    // text block.
    expect(
      screen.getByRole('button', { name: 'Open image 1 of 1' })
    ).toBeInTheDocument()
  })

  test('keeps the requested model parameter when it differs from the billed model', async () => {
    mockedAdminFetch.mockResolvedValue(
      asResult({
        id: 1,
        request_id: 'req-abc',
        request_body: JSON.stringify({
          model: 'doubao-seedance-2-0-mini-260615',
          prompt: 'A cat walks across the room',
          seconds: 7,
        }),
        response_body: '',
        is_stream: false,
        is_completed: true,
        response_size: 10,
        status_code: 200,
        created_at: 1700000000,
      })
    )
    renderDialog({
      log: buildLog({ model_name: 'upstream-redirected' }),
      isAdmin: true,
    })

    await waitFor(() =>
      expect(
        screen.getByText('A cat walks across the room')
      ).toBeInTheDocument()
    )
    // Redirected request: the billed model in the stat card and the model
    // the client actually asked for in the parameter list both stay
    // visible.
    expect(screen.getByText('upstream-redirected')).toBeInTheDocument()
    expect(
      screen.getByText('doubao-seedance-2-0-mini-260615')
    ).toBeInTheDocument()
  })

  test('shows the task id on the output tab for a video task creation', async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue()
    mockedAdminFetch.mockResolvedValue(
      asResult({
        id: 1,
        request_id: 'req-abc',
        request_body: JSON.stringify({
          model: 'doubao-seedance-2-0-mini-260615',
          prompt: 'A cat walks across the room',
          seconds: '5',
        }),
        response_body: JSON.stringify({
          id: 'task_abc',
          task_id: 'task_abc',
          status: 'queued',
          model: 'doubao-seedance-2-0-mini-260615',
          created_at: 1700000000,
        }),
        is_stream: false,
        is_completed: true,
        response_size: 120,
        status_code: 200,
        created_at: 1700000000,
      })
    )
    const user = userEvent.setup()
    renderDialog({ log: buildLog({}), isAdmin: true, initialTab: 'output' })

    await waitFor(() => expect(screen.getByText('Task ID')).toBeInTheDocument())
    expect(screen.getByText('task_abc')).toBeInTheDocument()
    // The raw video status is normalized to the shared task status label.
    expect(screen.getByText('Queued')).toBeInTheDocument()
    // Copying the task id goes through the shared CopyButton.
    await user.click(screen.getByRole('button', { name: 'Copy to clipboard' }))
    expect(writeText).toHaveBeenCalledWith('task_abc')
  })

  test('requires a generation request path before showing the prompt view', async () => {
    const promptBody = JSON.stringify({
      model: 'gpt-3.5-turbo-instruct',
      prompt: 'Say hi',
      n: 2,
    })
    const baseRow = {
      id: 1,
      request_id: 'req-abc',
      request_body: promptBody,
      response_body: '',
      is_stream: false,
      is_completed: true,
      response_size: 40,
      status_code: 200,
      created_at: 1700000000,
    }

    // A legacy completions path keeps the request on the chat fallback…
    mockedAdminFetch.mockResolvedValue(
      asResult({
        ...baseRow,
        // other.request_path disambiguates the minimal prompt body.
        request_body: promptBody,
      })
    )
    const { unmount } = renderDialog({
      log: buildLog({
        other: JSON.stringify({ request_path: '/v1/completions' }),
      }),
      isAdmin: true,
    })
    await waitFor(() =>
      expect(
        screen.getByText('Unable to parse this request as a chat request.')
      ).toBeInTheDocument()
    )
    unmount()

    // …while the same body from an image endpoint renders the prompt view.
    mockedAdminFetch.mockResolvedValue(asResult({ ...baseRow }))
    renderDialog({
      log: buildLog({
        other: JSON.stringify({ request_path: '/v1/images/generations' }),
      }),
      isAdmin: true,
    })
    await waitFor(() => expect(screen.getByText('Say hi')).toBeInTheDocument())
  })
})
