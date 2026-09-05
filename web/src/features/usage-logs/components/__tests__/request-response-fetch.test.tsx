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
 * Regression tests for the generic details dialog's Request/Response tab.
 * The non-admin list returns synthetic display ids, so the tab MUST fetch by
 * request_id; asserting the fetch choice guards against the misfetch defect
 * coming back.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')

const { getRequestResponseByLogId, getSelfRequestResponseByRequestId } =
  await import('../../api')
const { DetailsDialog } = await import('../dialogs/details-dialog')

vi.mock('../../api', () => ({
  getRequestResponseByLogId: vi.fn(),
  getSelfRequestResponseByRequestId: vi.fn(),
}))

vi.mock('@/lib/lobe-icon', () => ({
  getLobeIcon: () => null,
}))

const mockedAdminFetch = vi.mocked(getRequestResponseByLogId)
const mockedSelfFetch = vi.mocked(getSelfRequestResponseByRequestId)

// jsdom lacks the Web Animations API used by the Base UI ScrollArea viewport.
beforeAll(() => {
  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }
})

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

function buildLog(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1, // synthetic display id on the non-admin list
    user_id: 7,
    created_at: 1700000000,
    type: 2,
    content: '',
    username: 'alice',
    token_name: 'key',
    model_name: 'gpt-4o',
    quota: 1,
    prompt_tokens: 0,
    completion_tokens: 0,
    use_time: 1,
    is_stream: false,
    channel: 0,
    channel_name: '',
    token_id: 1,
    group: 'default',
    ip: '',
    other: '',
    request_id: 'req-1',
    upstream_request_id: '',
    ...overrides,
  }
}

function renderDialog(props: {
  log: Record<string, unknown>
  isAdmin: boolean
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <DetailsDialog
          log={props.log as never}
          isAdmin={props.isAdmin}
          isRoot={false}
          open
          onOpenChange={() => {}}
        />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

function asResult(data: unknown) {
  return { success: true, message: '', data: data as never }
}

beforeEach(() => {
  mockedAdminFetch.mockReset()
  mockedSelfFetch.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('DetailsDialog Request/Response tab fetch path', () => {
  test('non-admin fetches by request_id, never by the synthetic display id', async () => {
    mockedSelfFetch.mockResolvedValue(asResult(null))
    const user = userEvent.setup()
    renderDialog({ log: buildLog({}), isAdmin: false })

    await user.click(
      screen.getByRole('button', { name: /Request \/ Response/ })
    )
    await waitFor(() => expect(mockedSelfFetch).toHaveBeenCalledWith('req-1'))
    expect(mockedAdminFetch).not.toHaveBeenCalled()
  })

  test('admin still fetches by log id', async () => {
    mockedAdminFetch.mockResolvedValue(asResult(null))
    const user = userEvent.setup()
    renderDialog({ log: buildLog({}), isAdmin: true })

    await user.click(
      screen.getByRole('button', { name: /Request \/ Response/ })
    )
    await waitFor(() => expect(mockedAdminFetch).toHaveBeenCalledWith(1, true))
    expect(mockedSelfFetch).not.toHaveBeenCalled()
  })

  test('non-admin log without request_id explains the failure without fetching', async () => {
    const user = userEvent.setup()
    renderDialog({ log: buildLog({ request_id: '' }), isAdmin: false })

    await user.click(
      screen.getByRole('button', { name: /Request \/ Response/ })
    )
    await waitFor(() =>
      expect(
        screen.getByText('Failed to load request/response data')
      ).toBeInTheDocument()
    )
    expect(mockedSelfFetch).not.toHaveBeenCalled()
    expect(mockedAdminFetch).not.toHaveBeenCalled()
  })
})
