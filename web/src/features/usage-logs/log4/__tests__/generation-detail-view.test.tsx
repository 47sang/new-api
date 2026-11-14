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
const { QueryClientProvider } = await import('@tanstack/react-query')
const { createAppQueryClient } = await import('@/lib/query-client')

const { getTaskResultPreview } = await import('../../api')
const { Log4GenerationDetailView } = await import('../log4-generation-detail-view')

vi.mock('../../api', () => ({
  getTaskResultPreview: vi.fn(),
}))

const mockedPreview = vi.mocked(getTaskResultPreview)

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const generationRequest = {
  format: 'generation' as const,
  prompt: 'A cat walks across the room',
  params: [
    { key: 'seconds', value: '5' },
    { key: 'model', value: 'seedance-demo' },
  ],
  images: [],
}

const data = {
  id: 1,
  request_id: 'req-abc',
  request_body: JSON.stringify({
    model: 'seedance-demo',
    prompt: 'A cat walks across the room',
    seconds: '5',
  }),
  response_body: JSON.stringify({
    id: 'task_abc',
    task_id: 'task_abc',
    status: 'queued',
  }),
  is_stream: false,
  is_completed: true,
  response_size: 80,
  status_code: 200,
  session_id: '',
  created_at: 1700000000,
}

const log = {
  id: 42,
  user_id: 1,
  created_at: 1700000000,
  type: 2,
  content: '',
  username: 'alice',
  token_name: 'key',
  model_name: 'seedance-demo',
  quota: 10,
  prompt_tokens: 0,
  completion_tokens: 0,
  use_time: 2,
  is_stream: false,
  channel: 7,
  channel_name: '',
  token_id: 1,
  group: 'default',
  ip: '',
  other: JSON.stringify({ request_path: '/v1/videos' }),
  request_id: 'req-abc',
  upstream_request_id: '',
}

function renderView() {
  const queryClient = createAppQueryClient()
  queryClient.setDefaultOptions({ queries: { retry: false } })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <Log4GenerationDetailView
          request={generationRequest}
          response={{
            format: 'openai',
            task: { id: 'task_abc', status: 'queued' },
          }}
          data={data}
          log={log as never}
          other={{ request_path: '/v1/videos' }}
        />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

beforeEach(() => {
  mockedPreview.mockReset()
  mockedPreview.mockResolvedValue({
    success: true,
    message: '',
    data: {
      task_id: 'task_abc',
      status: 'SUCCESS',
      result_url: 'https://cdn.example/out.mp4?sig=1',
      format: 'mp4',
    },
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('Log4GenerationDetailView', () => {
  test('stacks request modes above an upstream video player', async () => {
    const user = userEvent.setup()
    renderView()

    expect(screen.getByText('A cat walks across the room')).toBeInTheDocument()
    expect(screen.getByText('task_abc')).toBeInTheDocument()

    await waitFor(() => {
      const video = document.querySelector('video')
      expect(video).toHaveAttribute(
        'src',
        'https://cdn.example/out.mp4?sig=1'
      )
    })

    await user.click(screen.getByRole('button', { name: 'Messages' }))
    expect(screen.getByText('A cat walks across the room')).toBeInTheDocument()

    const jsonButtons = screen.getAllByRole('button', { name: 'JSON' })
    await user.click(jsonButtons[0])
    expect(
      screen.getByText(/"prompt": "A cat walks across the room"/)
    ).toBeInTheDocument()

    await user.click(jsonButtons[jsonButtons.length - 1])
    expect(screen.getByText(/"task_id": "task_abc"/)).toBeInTheDocument()
  })
})
