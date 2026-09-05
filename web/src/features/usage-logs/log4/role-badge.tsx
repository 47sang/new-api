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
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import type { Log4Role } from './request-body'
import { LOG4_ROLE_META } from './role-meta'

/** Colored role badge used by the message list and the by-role breakdown. */
export function RoleBadge(props: { role: Log4Role; className?: string }) {
  const { t } = useTranslation()
  const meta = LOG4_ROLE_META[props.role]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        props.className,
        meta.badgeClass
      )}
    >
      {t(meta.labelKey)}
    </span>
  )
}
