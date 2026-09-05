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
 * Visual style per message role, following the OpenRouter viewer palette
 * (System purple, User green, Assistant blue, Tool amber).
 */
import type { Log4Role } from './request-body'

export const LOG4_ROLE_META: Record<
  Log4Role,
  { labelKey: string; dotClass: string; badgeClass: string }
> = {
  system: {
    labelKey: 'System',
    dotClass: 'bg-violet-500',
    badgeClass: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  },
  user: {
    labelKey: 'User',
    dotClass: 'bg-emerald-500',
    badgeClass: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  assistant: {
    labelKey: 'Assistant',
    dotClass: 'bg-sky-500',
    badgeClass: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  tool: {
    labelKey: 'Tool',
    dotClass: 'bg-amber-500',
    badgeClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
}
