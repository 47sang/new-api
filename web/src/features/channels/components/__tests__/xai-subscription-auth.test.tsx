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
import { afterEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { XaiSubscriptionAuth } from '../drawers/xai-subscription-auth'

const SIGN_IN_BUTTON = 'Sign in with xAI account'
const USER_CODE = 'ABCD-EFGH'
const VERIFY_URI = 'https://accounts.x.ai/oauth2/device'

function mockApi(handlers: {
  start?: () => unknown
  status?: () => unknown
  current?: () => unknown
  cancel?: () => unknown
  channelStatus?: () => unknown
}) {
  vi.spyOn(api, 'post').mockImplementation(async (url: string) => {
    if (url.includes('/xai_subscription/start')) {
      return { data: handlers.start?.() ?? {} } as never
    }
    if (url.includes('/xai_subscription/cancel')) {
      return { data: handlers.cancel?.() ?? { success: true } } as never
    }
    if (url.includes('/xai_subscription/signout')) {
      return { data: { success: true } } as never
    }
    return { data: {} } as never
  })
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    // 带渠道 id 的状态接口（编辑态查询）要先于登录轮询的 status 判断
    if (/\/channel\/\d+\/xai_subscription\/status/.test(url)) {
      return {
        data: handlers.channelStatus?.() ?? { signed_in: false },
      } as never
    }
    if (url.includes('/xai_subscription/status')) {
      return { data: handlers.status?.() ?? {} } as never
    }
    if (url.includes('/xai_subscription/current')) {
      return { data: handlers.current?.() ?? { active: false } } as never
    }
    return { data: {} } as never
  })
}

function renderAuth(
  value = '',
  onChange = vi.fn(),
  channelId: number | null = null
) {
  const user = userEvent.setup()
  const view = render(
    <XaiSubscriptionAuth
      value={value}
      onChange={onChange}
      channelId={channelId}
    />
  )
  return { user, onChange, ...view }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('XaiSubscriptionAuth', () => {
  test('未登录时展示登录按钮与风险说明，不展示密钥输入框', async () => {
    renderAuth()
    expect(screen.getByText(SIGN_IN_BUTTON)).toBeInTheDocument()
    expect(
      screen.getByText(/This sign-in borrows the public sign-in entry/)
    ).toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText('Subscription credential (OAuth JSON)')
    ).not.toBeInTheDocument()
  })

  test('点击登录后展示短码与验证页，轮询成功后把密钥交还表单', async () => {
    mockApi({
      start: () => ({
        success: true,
        data: {
          session_id: 'sess-1',
          user_code: USER_CODE,
          verification_uri: VERIFY_URI,
          expires_in: 600,
        },
      }),
      status: () => ({
        success: true,
        data: {
          status: 'success',
          key: '{"access_token":"at-1","email":"grok@example.com"}',
          email: 'grok@example.com',
        },
      }),
    })
    const { user, onChange } = renderAuth()

    await user.click(screen.getByText(SIGN_IN_BUTTON))
    expect(await screen.findByText(USER_CODE)).toBeInTheDocument()
    expect(screen.getByText(/Valid for 10 minutes/)).toBeInTheDocument()

    // 轮询（2 秒一轮）拿到成功后交还表单
    await waitFor(
      () => {
        expect(onChange).toHaveBeenCalledWith(
          '{"access_token":"at-1","email":"grok@example.com"}'
        )
      },
      { timeout: 8000 }
    )
  })

  test('登录失败按类别给出文案与重试入口', async () => {
    mockApi({
      start: () => ({
        success: true,
        data: {
          session_id: 'sess-2',
          user_code: USER_CODE,
          verification_uri: VERIFY_URI,
          expires_in: 600,
        },
      }),
      status: () => ({
        success: true,
        data: { status: 'failed', reason: 'no_subscription' },
      }),
    })
    const { user } = renderAuth()

    await user.click(screen.getByText(SIGN_IN_BUTTON))
    expect(
      await screen.findByText(
        /This account has no subscription that can use this interface/,
        undefined,
        { timeout: 8000 }
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Try signing in again')).toBeInTheDocument()
  })

  test('重开抽屉恢复进行中的登录', async () => {
    mockApi({
      current: () => ({
        success: true,
        data: {
          active: true,
          session_id: 'sess-3',
          user_code: USER_CODE,
          verification_uri: VERIFY_URI,
          remain_sec: 420,
        },
      }),
    })
    renderAuth()
    expect(await screen.findByText(USER_CODE)).toBeInTheDocument()
    expect(
      screen.getByText('Waiting for confirmation in your browser')
    ).toBeInTheDocument()
  })

  test('已登录时展示账号与退出入口，退出只清表单值', async () => {
    const { user, onChange } = renderAuth(
      '{"access_token":"at-1","refresh_token":"rt-1","email":"grok@example.com"}'
    )
    expect(
      screen.getByText('Signed in with xAI subscription')
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Signed in as grok@example\.com/)
    ).toBeInTheDocument()

    await user.click(screen.getByText('Sign out'))
    expect(onChange).toHaveBeenCalledWith('')
  })

  test('编辑已有渠道时经状态接口恢复「已登录」态', async () => {
    mockApi({
      channelStatus: () => ({
        success: true,
        data: {
          signed_in: true,
          email: 'grok@example.com',
          refreshable: true,
        },
      }),
    })
    renderAuth('', vi.fn(), 18)
    expect(
      await screen.findByText('Signed in with xAI subscription')
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Signed in as grok@example\.com/)
    ).toBeInTheDocument()
  })

  test('退出登录走后端端点并清表单', async () => {
    mockApi({
      channelStatus: () => ({
        success: true,
        data: { signed_in: true, email: 'grok@example.com', refreshable: true },
      }),
    })
    const { user, onChange } = renderAuth('', vi.fn(), 18)
    await user.click(await screen.findByText('Sign out'))
    expect(api.post).toHaveBeenCalledWith(
      expect.stringContaining('/xai_subscription/signout'),
      {},
      expect.anything()
    )
    expect(onChange).toHaveBeenCalledWith('')
  })

  test('手动粘贴后备入口可展开', async () => {
    const { user } = renderAuth()
    await user.click(screen.getByText('Paste OAuth JSON manually'))
    expect(
      screen.getByPlaceholderText('Subscription credential (OAuth JSON)')
    ).toBeInTheDocument()
  })

  test('取消登录回到未登录态', async () => {
    mockApi({
      start: () => ({
        success: true,
        data: {
          session_id: 'sess-4',
          user_code: USER_CODE,
          verification_uri: VERIFY_URI,
          expires_in: 600,
        },
      }),
      status: () => ({
        success: true,
        data: { status: 'pending', remain_sec: 600 },
      }),
    })
    const { user } = renderAuth()

    await user.click(screen.getByText(SIGN_IN_BUTTON))
    expect(await screen.findByText(USER_CODE)).toBeInTheDocument()
    await user.click(screen.getByText('Cancel'))
    expect(await screen.findByText(SIGN_IN_BUTTON)).toBeInTheDocument()
    expect(api.post).toHaveBeenCalledWith(
      expect.stringContaining('/xai_subscription/cancel'),
      {},
      expect.anything()
    )
  })
})
