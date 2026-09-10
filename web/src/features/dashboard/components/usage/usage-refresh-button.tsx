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
 * 用量分析页的刷新按钮：按共享前缀失效整页两路查询（主窗口 / 近一年热力图），
 * 任一查询在途时禁用。按钮样式与 Log4 筛选栏的刷新按钮保持一致。
 */
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { USAGE_ANALYTICS_QUERY_KEY_ROOT } from '@/features/dashboard/constants'

export function UsageRefreshButton() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fetching = useIsFetching({ queryKey: [USAGE_ANALYTICS_QUERY_KEY_ROOT] })

  return (
    <Button
      variant='outline'
      size='icon'
      className='size-8'
      onClick={() =>
        void queryClient.invalidateQueries({
          queryKey: [USAGE_ANALYTICS_QUERY_KEY_ROOT],
        })
      }
      disabled={fetching > 0}
      aria-label={t('Refresh')}
    >
      <RefreshCw className='size-4' aria-hidden='true' />
    </Button>
  )
}
