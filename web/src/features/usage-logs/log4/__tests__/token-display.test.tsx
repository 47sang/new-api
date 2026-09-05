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
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')

const { getUserLogs } = await import('../../api')
const { Log4Table } = await import('../log4-table')

vi.mock('../../api', () => ({
  getAllLogs: vi.fn(),
  getUserLogs: vi.fn(),
}))

vi.mock('@/lib/lobe-icon', () => ({
  getLobeIcon: () => null,
}))

const mockedGetUserLogs = vi.mocked(getUserLogs)

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

type LogsResponse = Awaited<ReturnType<typeof getUserLogs>>

function asLogsResponse(value: unknown): LogsResponse {
  return value as LogsResponse
}

function buildLog(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    user_id: 1,
    created_at: 1700000000,
    type: 2,
    content: '',
    username: 'alice',
    token_name: 'key',
    model_name: 'gpt-4o',
    quota: 10,
    prompt_tokens: 0,
    completion_tokens: 0,
    use_time: 2,
    is_stream: true,
    channel: 7,
    channel_name: '',
    token_id: 1,
    group: 'default',
    ip: '',
    other: '',
    request_id: '',
    upstream_request_id: '',
    ...overrides,
  }
}

const filters = {
  type: '2',
  model: '',
  startSeconds: undefined,
  endSeconds: 1700003600,
}

function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <Log4Table isAdmin={false} filters={filters} refreshNonce={0} />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

// The cell's <td> ancestors share the same textContent as the target span,
// so exact-content matchers must tolerate multiple hits.
function expectTextContent(content: string): void {
  expect(
    screen.getAllByText((_, el) => el?.textContent === content).length
  ).toBeGreaterThan(0)
}

function hasTextContent(content: string): boolean {
  return (
    screen.queryAllByText((_, el) => el?.textContent === content).length > 0
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): unknown[] {
        return []
      }
    }
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Log4Table token breakdown display', () => {
  test('shows input, output and labelled cache read/write token counts', async () => {
    mockedGetUserLogs.mockResolvedValue(
      asLogsResponse({
        success: true,
        message: '',
        data: {
          items: [
            buildLog({
              prompt_tokens: 117734,
              completion_tokens: 8,
              other: JSON.stringify({
                cache_tokens: 110464,
                cache_creation_tokens: 1024,
              }),
            }),
          ],
          total: 1,
          page: 1,
          page_size: 3,
        },
      })
    )
    renderTable()

    await waitFor(() => expectTextContent('117,734 tok'))
    // Input (prompt) and output (completion) token counts
    expectTextContent('8 tok')
    // Cache amounts carry an explicit label, not just an arrow glyph
    expectTextContent('Cache Read 110,464')
    expectTextContent('Cache Write 1,024')
  })

  test('omits the cache row when the log has no cache activity', async () => {
    mockedGetUserLogs.mockResolvedValue(
      asLogsResponse({
        success: true,
        message: '',
        data: {
          items: [
            buildLog({ prompt_tokens: 42, completion_tokens: 7, other: '' }),
          ],
          total: 1,
          page: 1,
          page_size: 3,
        },
      })
    )
    renderTable()

    await waitFor(() => expectTextContent('42 tok'))
    expectTextContent('7 tok')
    expect(hasTextContent('Cache Read')).toBe(false)
    expect(hasTextContent('Cache Write')).toBe(false)
  })

  test('sums split 5m/1h cache creation tokens into the write label', async () => {
    mockedGetUserLogs.mockResolvedValue(
      asLogsResponse({
        success: true,
        message: '',
        data: {
          items: [
            buildLog({
              prompt_tokens: 900,
              completion_tokens: 10,
              other: JSON.stringify({
                cache_tokens: 0,
                cache_creation_tokens_5m: 300,
                cache_creation_tokens_1h: 400,
              }),
            }),
          ],
          total: 1,
          page: 1,
          page_size: 3,
        },
      })
    )
    renderTable()

    await waitFor(() => expectTextContent('Cache Write 700'))
    expect(hasTextContent('Cache Read')).toBe(false)
  })
})
