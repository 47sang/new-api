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
import { render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { beforeAll, describe, expect, test } from 'vitest'

import { formatLogQuota } from '@/lib/format'

import type { UsageLog } from '../../data/schema'
import type { LogOtherData, RequestResponseLog } from '../../types'
import { Log4ResponseView } from '../log4-response-view'
import type { ParsedResponse } from '../request-body'

const data: RequestResponseLog = {
  id: 1,
  request_id: 'req-abc',
  request_body: '{}',
  response_body: '{}',
  is_stream: true,
  is_completed: true,
  response_size: 300,
  status_code: 200,
  created_at: 1700000000,
}

const response: ParsedResponse = {
  format: 'openai',
  content: 'It is sunny.',
  finishReason: 'stop',
}

const log = {
  id: 42,
  quota: 46377,
  prompt_tokens: 100,
  completion_tokens: 6963,
  model_name: 'glm-5.3-flash',
  other: '',
} as unknown as UsageLog

function normalizedText(value: string | null): string {
  return (value ?? '').replaceAll(/\s/g, '')
}

function renderView(other: LogOtherData = {} as LogOtherData) {
  return render(
    <Log4ResponseView data={data} response={response} log={log} other={other} />
  )
}

describe('Log4ResponseView stats row cost item', () => {
  beforeAll(() => {
    i18next.addResourceBundle('en', 'translation', {
      Subscription: 'Subscription',
      Cost: 'Cost',
    })
  })

  test('keeps the Cost label and the quota badge on one centered line', () => {
    renderView()

    // LogCostDisplay renders a block-level div; the cost item must be an
    // inline flex row so the badge sits beside the label instead of
    // stacking underneath it.
    const costItem = screen.getByText('Cost:').parentElement
    expect(costItem).toHaveClass('inline-flex')
    expect(costItem).toHaveClass('items-center')
    expect(normalizedText(costItem?.textContent ?? null)).toContain(
      normalizedText(formatLogQuota(log.quota))
    )
  })

  test('keeps the same single-line layout for the subscription badge', () => {
    renderView({ billing_source: 'subscription' } as LogOtherData)

    const costItem = screen.getByText('Cost:').parentElement
    expect(costItem).toHaveClass('inline-flex')
    expect(costItem).toHaveClass('items-center')
    expect(screen.getByText('Subscription')).toBeInTheDocument()
  })
})

describe('Log4ResponseView audio output', () => {
  test('renders an audio player instead of the empty state for an audio-only response', () => {
    const audioResponse: ParsedResponse = {
      format: 'openai',
      audio: { url: 'data:audio/wav;base64,UklGRi4A' },
    }
    const { container } = render(
      <Log4ResponseView
        data={data}
        response={audioResponse}
        log={log}
        other={{} as LogOtherData}
      />
    )

    expect(screen.getByText('Audio')).toBeInTheDocument()
    const player = container.querySelector('audio')
    expect(player).not.toBeNull()
    expect(player).toHaveAttribute('src', 'data:audio/wav;base64,UklGRi4A')
    expect(player).toHaveAttribute('controls')
    expect(screen.queryByText('No response body')).not.toBeInTheDocument()
  })
})
