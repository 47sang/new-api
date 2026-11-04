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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Check,
  Copy,
  LogIn,
  LogOut,
  RefreshCw,
} from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import {
  cancelXaiSubscriptionLogin,
  getXaiCurrentSubscriptionLogin,
  getXaiSubscriptionChannelStatus,
  getXaiSubscriptionLoginStatus,
  signOutXaiSubscription,
  startXaiSubscriptionLogin,
} from '../../api'

const POLL_INTERVAL_MS = 2000

type Phase = 'idle' | 'starting' | 'waiting' | 'failed'

type XaiSubscriptionAuthProps = {
  /** 表单 key 字段的当前值（订阅会话 JSON）。 */
  value: string
  onChange: (value: string) => void
  /** 编辑中的渠道 id：加载详情时后端不返回 key，靠它查是否已登录。 */
  channelId?: number | null
  disabled?: boolean
}

/** 从订阅会话 JSON 里取账号标识；解析不了返回空。 */
function readEmail(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { email?: unknown }
    return typeof parsed.email === 'string' ? parsed.email : ''
  } catch {
    return ''
  }
}

function hasAccessToken(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { access_token?: unknown }
    return typeof parsed.access_token === 'string' && parsed.access_token.length > 0
  } catch {
    return false
  }
}

/**
 * xAI 订阅渠道的密钥区：主路径是页面内设备码登录（不手填任何 Key），
 * 保留一个「手动粘贴 OAuth JSON」的后备入口供登录界面不可用时使用。
 */
export function XaiSubscriptionAuth({
  value,
  onChange,
  channelId,
  disabled = false,
}: XaiSubscriptionAuthProps) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('idle')
  const [sessionId, setSessionId] = useState('')
  const [userCode, setUserCode] = useState('')
  const [verificationUri, setVerificationUri] = useState('')
  const [remainSec, setRemainSec] = useState(0)
  const [failure, setFailure] = useState<{ reason: string; code?: string } | null>(
    null
  )
  const [copied, setCopied] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [savedEmail, setSavedEmail] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const signedIn = hasAccessToken(value) || savedEmail !== ''
  const email = signedIn ? readEmail(value) || savedEmail : ''

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // 卸载时停掉轮询；登录本身在服务端继续，重开抽屉会恢复
  useEffect(() => stopPolling, [stopPolling])

  const pollOnce = useCallback(
    async (id: string) => {
      try {
        const res = await getXaiSubscriptionLoginStatus(id)
        const data = res.data
        if (!data) return
        if (typeof data.remain_sec === 'number') setRemainSec(data.remain_sec)
        if (data.status === 'success' && data.key) {
          stopPolling()
          onChange(data.key)
          setPhase('idle')
          setSessionId('')
          return
        }
        if (data.status === 'failed') {
          stopPolling()
          setFailure({ reason: data.reason ?? '', code: data.code })
          setPhase('failed')
          setSessionId('')
        }
      } catch {
        // 轮询失败不打断等待：网络波动时下一轮再问
      }
    },
    [onChange, stopPolling]
  )

  const startPolling = useCallback(
    (id: string) => {
      stopPolling()
      pollRef.current = setInterval(() => {
        void pollOnce(id)
      }, POLL_INTERVAL_MS)
    },
    [pollOnce, stopPolling]
  )

  // 编辑已有渠道时后端不返回 key，用只读状态接口判断「已登录」
  useEffect(() => {
    if (!channelId || hasAccessToken(value)) return
    let alive = true
    void (async () => {
      try {
        const res = await getXaiSubscriptionChannelStatus(channelId)
        if (!alive) return
        setSavedEmail(res.data?.signed_in ? (res.data.email ?? '') : '')
      } catch {
        // 查不到就按未登录展示，管理员可以重新发起登录
      }
    })()
    return () => {
      alive = false
    }
    // 只在挂载时查一次：登录成功后表单里就有值了，不需要再查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])

  // 挂载时恢复进行中的登录：刷新页面、重开抽屉都不丢进度
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await getXaiCurrentSubscriptionLogin()
        const data = res.data
        if (!alive || !data?.active || !data.session_id) return
        setSessionId(data.session_id)
        setUserCode(data.user_code ?? '')
        setVerificationUri(data.verification_uri ?? '')
        setRemainSec(data.remain_sec ?? 0)
        setFailure(null)
        setPhase('waiting')
        startPolling(data.session_id)
      } catch {
        // 恢复不了就停在未登录态，管理员可以重新发起
      }
    })()
    return () => {
      alive = false
    }
  }, [startPolling])

  const handleStart = useCallback(async () => {
    setPhase('starting')
    setFailure(null)
    try {
      const res = await startXaiSubscriptionLogin()
      const data = res.data
      if (!data?.session_id) {
        setPhase('failed')
        setFailure({ reason: data?.reason ?? 'rejected' })
        return
      }
      setSessionId(data.session_id)
      setUserCode(data.user_code ?? '')
      setVerificationUri(data.verification_uri ?? '')
      setRemainSec(data.expires_in ?? 0)
      setPhase('waiting')
      startPolling(data.session_id)
    } catch {
      setPhase('failed')
      setFailure({ reason: 'network' })
    }
  }, [startPolling])

  const handleCancel = useCallback(async () => {
    stopPolling()
    if (sessionId) {
      try {
        await cancelXaiSubscriptionLogin(sessionId)
      } catch {
        // 取消失败不影响回到未登录态
      }
    }
    setSessionId('')
    setPhase('idle')
  }, [sessionId, stopPolling])

  const handleSignOut = useCallback(async () => {
    if (channelId) {
      try {
        await signOutXaiSubscription(channelId)
      } catch {
        // 后端清理失败时仍然清掉表单值，保存时不把凭证带回去
      }
    }
    setSavedEmail('')
    setManualOpen(false)
    onChange('')
  }, [channelId, onChange])

  const handleCopyAndReopen = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(userCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板不可用时至少把验证页打开
    }
    if (verificationUri) window.open(verificationUri, '_blank', 'noopener')
  }, [userCode, verificationUri])

  if (signedIn) {
    return (
      <div className='flex flex-col gap-3'>
        <Alert>
          <Check className='h-4 w-4' />
          <AlertTitle>{t('Signed in with xAI subscription')}</AlertTitle>
          <AlertDescription>
            {email
              ? t('Signed in as {{email}}', { email })
              : t('Subscription credential is stored on this gateway')}
          </AlertDescription>
        </Alert>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={disabled}
            onClick={() => void handleSignOut()}
          >
            <LogOut className='mr-2 h-4 w-4' />
            {t('Sign out')}
          </Button>
          <span className='text-muted-foreground text-xs'>
            {t(
              'Signing out only clears the credential on this gateway. Revoke access in your xAI account settings.'
            )}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      <Alert>
        <AlertTriangle className='h-4 w-4' />
        <AlertTitle>{t('xAI subscription sign-in')}</AlertTitle>
        <AlertDescription>
          {t(
            'This sign-in borrows the public sign-in entry of xAI official command-line tool; xAI did not set it up for this project. xAI may restrict this use, and some subscription tiers still cannot make calls after signing in (you will see 403). If that happens, use an xAI API key instead.'
          )}
        </AlertDescription>
      </Alert>
      <p className='text-muted-foreground text-xs'>
        {t(
          'The credential is stored encrypted on this gateway only, and is never written to logs.'
        )}
      </p>

      {phase === 'waiting' && (
        <div className='border-border/60 flex flex-col gap-3 rounded-md border border-dashed p-4'>
          <p className='text-sm font-medium'>
            {t('Waiting for confirmation in your browser')}
          </p>
          <p
            className='font-mono text-2xl tracking-widest'
            data-testid='xai-sub-user-code'
          >
            {userCode}
          </p>
          <p className='text-muted-foreground text-xs'>
            {remainSec > 0
              ? t('Valid for {{minutes}} minutes', {
                  minutes: Math.max(1, Math.ceil(remainSec / 60)),
                })
              : t('The code has expired')}
          </p>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => void handleCopyAndReopen()}
            >
              {copied ? (
                <Check className='mr-2 h-4 w-4' />
              ) : (
                <Copy className='mr-2 h-4 w-4' />
              )}
              {t('Copy code and open verification page')}
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => void handleCancel()}
            >
              {t('Cancel')}
            </Button>
          </div>
        </div>
      )}

      {phase === 'failed' && failure && (
        <Alert variant='destructive'>
          <AlertTriangle className='h-4 w-4' />
          <AlertTitle>{t('Sign-in failed')}</AlertTitle>
          <AlertDescription>
            {failureReasonText(t, failure.reason)}
          </AlertDescription>
        </Alert>
      )}

      {phase !== 'waiting' && (
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            type='button'
            size='sm'
            disabled={disabled || phase === 'starting'}
            onClick={() => void handleStart()}
          >
            {phase === 'starting' ? (
              <RefreshCw className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <LogIn className='mr-2 h-4 w-4' />
            )}
            {phase === 'failed'
              ? t('Try signing in again')
              : t('Sign in with xAI account')}
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => setManualOpen((open) => !open)}
          >
            {t('Paste OAuth JSON manually')}
          </Button>
        </div>
      )}

      {manualOpen && (
        <div className='flex flex-col gap-2'>
          <Textarea
            rows={4}
            className='font-mono text-xs'
            placeholder={t('Subscription credential (OAuth JSON)')}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
          <p className='text-muted-foreground text-xs'>
            {t(
              'Without refresh_token the credential cannot be renewed automatically and must be pasted again after it expires.'
            )}
          </p>
        </div>
      )}
    </div>
  )
}

/** 失败类别 → 界面文案。类别由服务端给，不含敏感信息。 */
function failureReasonText(
  t: (key: string, options?: Record<string, unknown>) => string,
  reason: string
): string {
  switch (reason) {
    case 'denied':
      return t('The authorization was declined in the browser.')
    case 'expired':
      return t('The code expired before it was confirmed. Start again.')
    case 'timeout':
      return t('The sign-in timed out. Start again.')
    case 'network':
      return t('Could not reach xAI. Check the network and try again.')
    case 'no_subscription':
      return t(
        'This account has no subscription that can use this interface. Use an xAI API key instead.'
      )
    case 'bad_issuer':
      return t(
        'xAI sign-in could not be verified, so no request was sent. Try again later.'
      )
    default:
      return t('xAI declined this sign-in. Try again later.')
  }
}
