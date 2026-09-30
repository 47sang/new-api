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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance, type i18n } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { LogSettingsSection } from '../log-settings-section'

// 用空 en 资源渲染：所有文案回落到 i18n key 本身，断言稳定且不依赖某一语言
const RECLAIM_BUTTON = 'Reclaim space'
const CONFIRM_BUTTON = 'Confirm reclaim'

let testI18n: i18n

function renderSection() {
  const actionsContainer = document.createElement('div')
  document.body.append(actionsContainer)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={testI18n}>
      <QueryClientProvider client={queryClient}>
        <SettingsPageProvider actionsContainer={actionsContainer}>
          {children}
        </SettingsPageProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
  return render(<LogSettingsSection defaultEnabled={false} defaultRequestResponseLogEnabled={false} />, {
    wrapper,
  })
}

beforeEach(async () => {
  testI18n = createInstance()
  await testI18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} }, zh },
    interpolation: { escapeValue: false },
  })
  vi.restoreAllMocks()
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => ({
    data:
      url === '/api/performance/logs'
        ? { success: true, data: { enabled: false } }
        : { success: true, data: null },
  }))
})

describe('LogSettingsSection 数据库空间回收', () => {
  it('点击入口先弹出二次确认，未确认不得发起回收请求', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true, data: { vacuumed: true, reclaimed_bytes: 0 } } })

    renderSection()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: RECLAIM_BUTTON }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Reclaim SQLite database space?')
    expect(dialog).toHaveTextContent(
      'This rewrites the entire database file and blocks log writes until it finishes.'
    )
    expect(post).not.toHaveBeenCalled()

    // 取消后同样不得发起请求
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(post).not.toHaveBeenCalled()
  })

  it('确认后调用回收接口，并展示实际回收的空间大小', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, data: { vacuumed: true, reclaimed_bytes: 3 * 1024 * 1024 } },
    })
    const successToast = vi.spyOn(toast, 'success').mockReturnValue('')

    renderSection()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: RECLAIM_BUTTON }))
    await user.click(await screen.findByRole('button', { name: CONFIRM_BUTTON }))

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/system-task/log-vacuum')
    )
    await waitFor(() =>
      expect(successToast).toHaveBeenCalledWith(
        expect.stringContaining('3 MB')
      )
    )
  })

  it('回收失败时提示失败原因且不显示成功提示', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: false, message: 'database is locked' },
    })
    const successToast = vi.spyOn(toast, 'success').mockReturnValue('')
    const errorToast = vi.spyOn(toast, 'error').mockReturnValue('')

    renderSection()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: RECLAIM_BUTTON }))
    await user.click(await screen.findByRole('button', { name: CONFIRM_BUTTON }))

    await waitFor(() => expect(errorToast).toHaveBeenCalled())
    expect(successToast).not.toHaveBeenCalled()
  })
})
