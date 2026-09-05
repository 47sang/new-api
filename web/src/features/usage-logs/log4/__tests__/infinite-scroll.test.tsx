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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')

const { getAllLogs, getUserLogs } = await import('../../api')
const { Log4Table } = await import('../log4-table')
const { LOG4_DEFAULT_TYPE } = await import('../lib')

vi.mock('../../api', () => ({
  getAllLogs: vi.fn(),
  getUserLogs: vi.fn(),
}))

// @lobehub/icons (via ModelBadge) transitively imports @emoji-mart JSON assets
// that vitest's externalized ESM loader rejects; icon rendering is irrelevant
// to the scrolling contracts under test.
vi.mock('@/lib/lobe-icon', () => ({
  getLobeIcon: () => null,
}))

// Small page size so tests render a handful of rows instead of a hundred.
// vi.hoisted keeps the value readable inside the hoisted vi.mock factories.
const PAGE_SIZE = vi.hoisted(() => 3)

vi.mock('../lib', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  LOG4_PAGE_SIZE: PAGE_SIZE,
}))

const mockedGetUserLogs = vi.mocked(getUserLogs)
const mockedGetAllLogs = vi.mocked(getAllLogs)

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  // zh exists so the language-switch regression test can assert translated
  // cell text; other tests keep running with the empty en catalog.
  resources: {
    en: { translation: {} },
    zh: { translation: { 'Cache Read': '缓存读取' } },
  },
})

type LogsResponse = Awaited<ReturnType<typeof getUserLogs>>

/** Cast a hand-built body to the shared endpoint response type. */
function asLogsResponse(value: unknown): LogsResponse {
  return value as LogsResponse
}

/** Endpoint response body for one page of logs. */
function envelope(page: {
  items: Array<Record<string, unknown>>
  total: number
  page: number
  page_size: number
}): LogsResponse {
  return asLogsResponse({ success: true, message: '', data: page })
}

let requestedPages: Array<number | undefined> = []

function buildLog(id: number): Record<string, unknown> {
  return {
    id,
    user_id: 1,
    created_at: 1700000000 - id,
    type: 2,
    content: '',
    username: 'alice',
    token_name: 'key',
    model_name: 'gpt-4o',
    quota: 10,
    prompt_tokens: 100,
    completion_tokens: 50,
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
  }
}

function fullPage(page: number) {
  const start = (page - 1) * PAGE_SIZE
  return {
    items: Array.from({ length: PAGE_SIZE }, (_, i) => buildLog(start + i + 1)),
    total: 100,
    page,
    page_size: PAGE_SIZE,
  }
}

function partialPage(page: number, count: number) {
  const start = (page - 1) * PAGE_SIZE
  return {
    items: Array.from({ length: count }, (_, i) => buildLog(start + i + 1)),
    total: 100,
    page,
    page_size: PAGE_SIZE,
  }
}

// --- IntersectionObserver stub with manual triggering -----------------------

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void

const observers: Array<{ callback: ObserverCallback }> = []

class IntersectionObserverMock {
  callback: ObserverCallback
  root: Element | null = null
  rootMargin = ''
  thresholds: number[] = []
  constructor(callback: ObserverCallback) {
    this.callback = callback
    observers.push({ callback })
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return []
  }
}

function triggerSentinelVisible(): void {
  const last = observers.at(-1)
  if (!last) throw new Error('No IntersectionObserver instance was created')
  last.callback([{ isIntersecting: true }])
}

// --- Test scaffolding --------------------------------------------------------

const baseFilters = {
  type: LOG4_DEFAULT_TYPE as string,
  model: '',
  startSeconds: undefined,
  endSeconds: 1700003600,
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderTable(
  overrides?: { isAdmin?: boolean; refreshNonce?: number },
  client = makeClient()
) {
  const view = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <Log4Table
          isAdmin={overrides?.isAdmin ?? false}
          filters={baseFilters}
          refreshNonce={overrides?.refreshNonce ?? 0}
        />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return { ...view, client }
}

function rowCount(): number {
  return document.querySelectorAll(
    '[data-slot="table-body"] [data-slot="table-row"]'
  ).length
}

function requestedPageParams(): Array<Record<string, unknown>> {
  return mockedGetUserLogs.mock.calls.map(
    (call) => call[0] as unknown as Record<string, unknown>
  )
}

/** Standard mock: page 1 full, page 2 partial (end of collection). */
function mockTwoPagesWithTail(): void {
  mockedGetUserLogs.mockImplementation(async (params) => {
    const p = (params as { p?: number }).p
    requestedPages.push(p)
    if (p === 1) return envelope(fullPage(1))
    return envelope(partialPage(2, 1))
  })
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', IntersectionObserverMock)
  requestedPages = []
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  observers.length = 0
  // The language-switch test leaves the UI language mid-suite otherwise.
  if (i18n.language !== 'en') {
    void i18n.changeLanguage('en')
  }
})

describe('Log4Table infinite scroll', () => {
  test('loads the first page on mount with frozen filters and page size cap', async () => {
    mockedGetUserLogs.mockResolvedValue(envelope(fullPage(1)))
    renderTable()

    await waitFor(() => expect(rowCount()).toBe(PAGE_SIZE))
    const params = requestedPageParams()[0]
    expect(params.p).toBe(1)
    expect(params.page_size).toBe(PAGE_SIZE)
    expect(params.type).toBe(2)
    expect(params.end_timestamp).toBe(baseFilters.endSeconds)
  })

  test('fetches the next page when the sentinel enters the viewport', async () => {
    mockTwoPagesWithTail()
    renderTable()

    await waitFor(() => expect(rowCount()).toBe(PAGE_SIZE))
    triggerSentinelVisible()

    await waitFor(() => expect(rowCount()).toBe(PAGE_SIZE + 1))
    expect(requestedPages).toEqual([1, 2])
    expect(screen.getByText('All 4 records loaded')).toBeInTheDocument()
  })

  test('stops fetching once a partial page ends the collection', async () => {
    mockTwoPagesWithTail()
    renderTable()

    await waitFor(() => expect(rowCount()).toBe(PAGE_SIZE))
    triggerSentinelVisible()
    await waitFor(() => expect(rowCount()).toBe(PAGE_SIZE + 1))

    triggerSentinelVisible()
    triggerSentinelVisible()
    expect(requestedPages).toEqual([1, 2])
    expect(screen.getByText('All 4 records loaded')).toBeInTheDocument()
  })

  test('does not request the next page again while one is in flight', async () => {
    let resolvePage2: ((value: LogsResponse) => void) | undefined
    mockedGetUserLogs.mockImplementation(async (params) => {
      const p = (params as { p?: number }).p
      requestedPages.push(p)
      if (p === 1) return envelope(fullPage(1))
      return new Promise<LogsResponse>((resolve) => {
        resolvePage2 = resolve
      })
    })
    renderTable()

    await waitFor(() => expect(rowCount()).toBe(PAGE_SIZE))
    triggerSentinelVisible()
    triggerSentinelVisible()
    triggerSentinelVisible()

    resolvePage2?.(envelope(partialPage(2, 1)))
    await waitFor(() => expect(rowCount()).toBe(PAGE_SIZE + 1))
    expect(requestedPages.filter((p) => p === 2)).toHaveLength(1)
  })

  test('does not auto-retry the next page after a failed fetch', async () => {
    mockedGetUserLogs.mockImplementation(async (params) => {
      const p = (params as { p?: number }).p
      requestedPages.push(p)
      if (p === 1) return envelope(fullPage(1))
      throw new Error('backend down')
    })
    renderTable()

    await waitFor(() => expect(rowCount()).toBe(PAGE_SIZE))
    triggerSentinelVisible()
    await waitFor(() =>
      expect(screen.getByText('Failed to load logs')).toBeInTheDocument()
    )

    // The sentinel stays on screen behind the error row; further observer
    // hits must not enqueue more doomed requests — retry is explicit.
    triggerSentinelVisible()
    triggerSentinelVisible()
    expect(requestedPages.filter((p) => p === 2)).toHaveLength(1)
  })

  test('resets the scroll position when the refresh nonce changes', async () => {
    mockedGetUserLogs.mockResolvedValue(envelope(fullPage(1)))
    const client = makeClient()
    const view = renderTable(undefined, client)
    await waitFor(() => expect(rowCount()).toBe(PAGE_SIZE))
    const scrollBody = document.querySelector(
      '.log4-scroll-body'
    ) as HTMLElement
    scrollBody.scrollTop = 500

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <Log4Table isAdmin={false} filters={baseFilters} refreshNonce={1} />
        </QueryClientProvider>
      </I18nextProvider>
    )

    await waitFor(() => expect(scrollBody.scrollTop).toBe(0))
  })

  test('uses the admin endpoint when the admin view is active', async () => {
    mockedGetAllLogs.mockResolvedValue(envelope(partialPage(1, 1)))
    renderTable({ isAdmin: true })

    await waitFor(() => expect(rowCount()).toBe(1))
    expect(mockedGetUserLogs).not.toHaveBeenCalled()
    expect(mockedGetAllLogs.mock.calls[0][0]).toMatchObject({ p: 1 })
  })

  test('shows a retry action when loading fails', async () => {
    mockedGetUserLogs.mockRejectedValue(new Error('boom'))
    renderTable()

    await waitFor(() =>
      expect(screen.getByText('Failed to load logs')).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  test('refetches from the first page when the refresh nonce changes', async () => {
    mockedGetUserLogs.mockResolvedValue(envelope(fullPage(1)))
    const client = makeClient()
    const view = renderTable(undefined, client)
    await waitFor(() => expect(rowCount()).toBe(PAGE_SIZE))
    const callsAfterFirstLoad = mockedGetUserLogs.mock.calls.length

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <Log4Table isAdmin={false} filters={baseFilters} refreshNonce={1} />
        </QueryClientProvider>
      </I18nextProvider>
    )

    await waitFor(() =>
      expect(mockedGetUserLogs.mock.calls.length).toBeGreaterThan(
        callsAfterFirstLoad
      )
    )
    expect(requestedPageParams().at(-1)?.p).toBe(1)
  })

  test('ignores non-intersecting observer entries', async () => {
    mockedGetUserLogs.mockResolvedValue(envelope(fullPage(1)))
    renderTable()
    await waitFor(() => expect(rowCount()).toBe(PAGE_SIZE))

    observers.at(-1)?.callback([{ isIntersecting: false }])
    expect(mockedGetUserLogs.mock.calls).toHaveLength(1)
  })

  test('renders the empty state when no logs match', async () => {
    mockedGetUserLogs.mockResolvedValue(
      envelope({ items: [], total: 0, page: 1, page_size: PAGE_SIZE })
    )
    renderTable()
    await waitFor(() =>
      expect(screen.getByText('No Logs Found')).toBeInTheDocument()
    )
    // Only the empty-state row is rendered — no log rows, no "all loaded" hint.
    expect(rowCount()).toBe(1)
    expect(screen.queryByText(/records loaded/)).not.toBeInTheDocument()
  })
})

describe('Log4Table load-more fallback', () => {
  test('fetches the next page when the load-more button is pressed', async () => {
    mockTwoPagesWithTail()
    renderTable()

    await waitFor(() => expect(rowCount()).toBe(PAGE_SIZE))
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => expect(rowCount()).toBe(PAGE_SIZE + 1))
    expect(requestedPages).toEqual([1, 2])
  })
})

describe('Log4Table row rerender on language change', () => {
  test('re-renders already-loaded cells when the UI language switches', async () => {
    // The table memoizes rows; cellRenderColumns must make column-definition
    // changes (new t() closures after a language switch) part of the render
    // identity, or loaded cells keep the previous language until refetch.
    await i18n.changeLanguage('en')
    const log = {
      ...buildLog(1),
      prompt_tokens: 110464,
      other: JSON.stringify({ cache_tokens: 110464 }),
    }
    mockedGetUserLogs.mockResolvedValue(
      envelope({ items: [log], total: 1, page: 1, page_size: 1 })
    )
    renderTable()

    await waitFor(() =>
      expect(screen.getAllByText(/Cache Read/).length).toBeGreaterThan(0)
    )

    await i18n.changeLanguage('zh')
    await waitFor(() => {
      expect(
        screen.getAllByText((_, el) =>
          Boolean(el?.textContent?.includes('缓存读取'))
        ).length
      ).toBeGreaterThan(0)
    })
    // No English remnants of the frozen cells remain in the loaded rows.
    expect(screen.queryByText('Cache Read')).not.toBeInTheDocument()
    await i18n.changeLanguage('en')
  })
})
