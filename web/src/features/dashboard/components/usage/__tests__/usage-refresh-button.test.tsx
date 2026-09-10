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
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { USAGE_ANALYTICS_QUERY_KEY_ROOT } from '../../../constants'
import { UsageRefreshButton } from '../usage-refresh-button'

function QueryProbe(props: { queryKey: unknown[]; queryFn: () => unknown }) {
  useQuery({ queryKey: props.queryKey, queryFn: props.queryFn, retry: false })
  return null
}

function renderWithQueries(
  queries: { queryKey: unknown[]; queryFn: () => unknown }[]
) {
  const queryClient = new QueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      {queries.map((query) => (
        <QueryProbe
          key={query.queryKey.join('|')}
          queryKey={query.queryKey}
          queryFn={query.queryFn}
        />
      ))}
      <UsageRefreshButton />
    </QueryClientProvider>
  )
}

describe('UsageRefreshButton', () => {
  test('点击刷新只重新拉取用量分析前缀查询，无关查询不受影响', async () => {
    const user = userEvent.setup()
    const usageFetch = vi.fn(() => Promise.resolve('usage'))
    const otherFetch = vi.fn(() => Promise.resolve('other'))
    renderWithQueries([
      {
        queryKey: [USAGE_ANALYTICS_QUERY_KEY_ROOT, 'main', 7, 0],
        queryFn: usageFetch,
      },
      { queryKey: ['unrelated'], queryFn: otherFetch },
    ])

    await waitFor(() => expect(usageFetch).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(otherFetch).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(usageFetch).toHaveBeenCalledTimes(2))
    expect(otherFetch).toHaveBeenCalledTimes(1)
  })

  test('存在在途查询时按钮禁用，查询完成后恢复可用', async () => {
    let resolveFetch: (value: string) => void = () => {}
    const pending = new Promise<string>((resolve) => {
      resolveFetch = resolve
    })
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <QueryProbe
          queryKey={[USAGE_ANALYTICS_QUERY_KEY_ROOT, 'year', 0]}
          queryFn={() => pending}
        />
        <UsageRefreshButton />
      </QueryClientProvider>
    )

    const button = screen.getByRole('button', { name: 'Refresh' })
    await waitFor(() => expect(button).toBeDisabled())

    resolveFetch('done')
    await waitFor(() => expect(button).toBeEnabled())
  })
})
