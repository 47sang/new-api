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
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { beforeAll, describe, expect, test } from 'vitest'

import type { UsageLog } from '../../data/schema'
import type { LogOtherData } from '../../types'
import { Log4GenerationView } from '../log4-generation-view'
import type { ParsedGenerationRequest } from '../request-body'

const log = {
  id: 42,
  quota: 82335,
  prompt_tokens: 0,
  completion_tokens: 0,
  model_name: 'doubao-seedream-5.0-lite',
  other: '',
} as unknown as UsageLog

const SCENE_URL = 'https://assets.example.com/scene.jpg'

const request: ParsedGenerationRequest = {
  format: 'generation',
  prompt: 'Make the CRT monitor an LCD panel',
  params: [
    { key: 'response_format', value: 'url' },
    { key: 'watermark', value: 'false' },
  ],
  images: [{ url: SCENE_URL }],
}

function renderView(
  overrides: Partial<ParsedGenerationRequest> = {},
  other: LogOtherData = {} as LogOtherData
) {
  return render(
    <Log4GenerationView
      request={{ ...request, ...overrides }}
      log={log}
      other={other}
    />
  )
}

describe('Log4GenerationView input layout', () => {
  beforeAll(() => {
    i18next.addResourceBundle('en', 'translation', {
      Model: 'Model',
      Cost: 'Cost',
      Parameters: 'Parameters',
      Prompt: 'Prompt',
      'Reference Images': 'Reference Images',
    })
  })

  test('renders model/cost facts and parameters above the prompt', () => {
    renderView()
    const model = screen.getByText('Model')
    const parameters = screen.getByText('Parameters')
    const prompt = screen.getByText('Prompt')
    // DOM order contract: the model/cost card and the parameters block
    // precede the prompt block, mirroring the chat input tab.
    expect(
      model.compareDocumentPosition(parameters) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      parameters.compareDocumentPosition(prompt) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  test('shows reference images as thumbnails that open the lightbox', async () => {
    const user = userEvent.setup()
    renderView()
    expect(screen.getByText('Reference Images')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open image 1 of 1' }))
    const preview = screen.getByRole('dialog')
    expect(preview).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Image Preview' })).toHaveAttribute(
      'src',
      SCENE_URL
    )
  })

  test('hides the reference-image section without images', () => {
    renderView({ images: [] })
    expect(screen.queryByText('Reference Images')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Open image 1 of 1' })
    ).toBeNull()
    // The prompt block still renders on its own.
    expect(screen.getByText('Prompt')).toBeInTheDocument()
  })
})
