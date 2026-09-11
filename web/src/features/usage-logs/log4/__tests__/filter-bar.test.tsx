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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')

const { getAllLogModelNames, getUserLogModelNames } = await import('../../api')
const { Log4FilterBar } = await import('../log4-filter-bar')

vi.mock('../../api', () => ({
  getAllLogModelNames: vi.fn(),
  getUserLogModelNames: vi.fn(),
}))

const mockedGetAllLogModelNames = vi.mocked(getAllLogModelNames)
const mockedGetUserLogModelNames = vi.mocked(getUserLogModelNames)

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  // The en catalog stays empty: assertions rely on the English source keys.
  resources: { en: { translation: {} } },
})

function modelNamesResponse(names: string[]) {
  return { success: true, message: '', data: names }
}

function renderFilterBar(
  props: Partial<Parameters<typeof Log4FilterBar>[0]> = {}
) {
  const onModelApply = vi.fn()
  const baseProps = {
    type: '2',
    rangeId: '24h' as const,
    model: '',
    isAdmin: false,
    isFetching: false,
    onTypeChange: vi.fn(),
    onRangeChange: vi.fn(),
    onModelApply,
    onRefresh: vi.fn(),
    ...props,
  }
  const view = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <Log4FilterBar {...baseProps} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return { ...view, onModelApply }
}

function getModelInput(): HTMLInputElement {
  return screen.getByRole('combobox', {
    name: 'Model Name',
  }) as HTMLInputElement
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Log4FilterBar model filter', () => {
  test('shows a clear button after typing and clicking it clears and applies an empty filter', () => {
    const { onModelApply } = renderFilterBar()

    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()

    fireEvent.change(getModelInput(), { target: { value: 'glm-5.3-flash' } })
    expect(getModelInput().value).toBe('glm-5.3-flash')

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(getModelInput().value).toBe('')
    expect(onModelApply).toHaveBeenCalledWith('')
  })

  test('fetches model names with the current filters on focus and applies the picked option', async () => {
    mockedGetUserLogModelNames.mockResolvedValue(
      modelNamesResponse(['gpt-4o', 'glm-5.3-flash'])
    )
    const { onModelApply } = renderFilterBar()

    fireEvent.focus(getModelInput())

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'glm-5.3-flash' })).toBeTruthy()
    })
    expect(mockedGetUserLogModelNames).toHaveBeenCalledWith({
      type: '2',
      start_timestamp: expect.any(Number),
      end_timestamp: expect.any(Number),
    })
    expect(mockedGetAllLogModelNames).not.toHaveBeenCalled()

    fireEvent.mouseDown(screen.getByRole('option', { name: 'glm-5.3-flash' }))

    expect(onModelApply).toHaveBeenCalledWith('glm-5.3-flash')
    expect(getModelInput().value).toBe('glm-5.3-flash')
  })

  test('queries all users model names through the admin endpoint for admin views', async () => {
    mockedGetAllLogModelNames.mockResolvedValue(
      modelNamesResponse(['claude-sonnet-5'])
    )
    renderFilterBar({ isAdmin: true })

    fireEvent.focus(getModelInput())

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: 'claude-sonnet-5' })
      ).toBeTruthy()
    })
    expect(mockedGetAllLogModelNames).toHaveBeenCalled()
    expect(mockedGetUserLogModelNames).not.toHaveBeenCalled()
  })

  test('narrows the dropdown to models containing the typed fragment', async () => {
    mockedGetUserLogModelNames.mockResolvedValue(
      modelNamesResponse(['gpt-4o', 'glm-5.3-flash', 'glm-4-flash'])
    )
    renderFilterBar()

    fireEvent.focus(getModelInput())
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'gpt-4o' })).toBeTruthy()
    })

    fireEvent.change(getModelInput(), { target: { value: 'glm' } })

    expect(screen.getByRole('option', { name: 'glm-5.3-flash' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'glm-4-flash' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'gpt-4o' })).toBeNull()
  })

  test('keeps the applied model draft on the input and applies it on blur', () => {
    const { onModelApply } = renderFilterBar({ model: 'gpt-4o' })

    expect(getModelInput().value).toBe('gpt-4o')

    fireEvent.change(getModelInput(), { target: { value: 'gpt-4o-mini' } })
    fireEvent.blur(getModelInput())

    expect(onModelApply).toHaveBeenCalledWith('gpt-4o-mini')
  })
})
