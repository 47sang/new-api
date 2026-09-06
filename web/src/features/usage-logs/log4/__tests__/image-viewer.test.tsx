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
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')

const { Log4ImageGallery } = await import('../log4-image-viewer')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const PNG_URI = 'data:image/png;base64,AAAA'
const JPEG_URI = 'data:image/jpeg;base64,BBBB'
const REMOTE_URL = 'https://example.com/picture.png'

function renderGallery(props: {
  images: Array<{ url: string; mediaType?: string }>
  totalCount?: number
}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Log4ImageGallery images={props.images} totalCount={props.totalCount} />
    </I18nextProvider>
  )
}

describe('Log4ImageGallery', () => {
  test('renders one accessible thumbnail per renderable image', () => {
    renderGallery({ images: [{ url: PNG_URI }, { url: REMOTE_URL }] })
    expect(
      screen.getByRole('button', { name: 'Open image 1 of 2' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open image 2 of 2' })
    ).toBeInTheDocument()
    // No fullscreen preview until a thumbnail is clicked
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('opens the fullscreen preview at the clicked image', async () => {
    const user = userEvent.setup()
    renderGallery({ images: [{ url: PNG_URI }, { url: JPEG_URI }] })
    await user.click(screen.getByRole('button', { name: 'Open image 2 of 2' }))
    const preview = screen.getByRole('dialog')
    expect(preview).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Image Preview' })).toHaveAttribute(
      'src',
      JPEG_URI
    )
    // The position indicator reflects the opened image
    expect(preview).toHaveTextContent('2 / 2')
  })

  test('navigates with next and previous controls and wraps around', async () => {
    const user = userEvent.setup()
    renderGallery({ images: [{ url: PNG_URI }, { url: JPEG_URI }] })
    await user.click(screen.getByRole('button', { name: 'Open image 1 of 2' }))
    const picture = () => screen.getByRole('img', { name: 'Image Preview' })
    expect(picture()).toHaveAttribute('src', PNG_URI)
    await user.click(screen.getByRole('button', { name: 'Next image' }))
    expect(picture()).toHaveAttribute('src', JPEG_URI)
    await user.click(screen.getByRole('button', { name: 'Previous image' }))
    expect(picture()).toHaveAttribute('src', PNG_URI)
    // Wrapping backwards from the first image lands on the last one
    await user.click(screen.getByRole('button', { name: 'Previous image' }))
    expect(picture()).toHaveAttribute('src', JPEG_URI)
    expect(screen.getByRole('dialog')).toHaveTextContent('2 / 2')
  })

  test('closes on the Escape key and keeps the thumbnails', async () => {
    const user = userEvent.setup()
    renderGallery({ images: [{ url: PNG_URI }] })
    await user.click(screen.getByRole('button', { name: 'Open image 1 of 1' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Open image 1 of 1' })
    ).toBeInTheDocument()
  })

  test('closes when clicking the black area but stays when clicking the picture', async () => {
    const user = userEvent.setup()
    renderGallery({ images: [{ url: PNG_URI }] })
    await user.click(screen.getByRole('button', { name: 'Open image 1 of 1' }))
    const preview = screen.getByRole('dialog')
    // A click on the picture itself must not dismiss the preview
    await user.click(screen.getByRole('img', { name: 'Image Preview' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // A click on the black area (the fullscreen popup itself) dismisses it
    await user.click(preview)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('closes via the top-right close control', async () => {
    const user = userEvent.setup()
    renderGallery({ images: [{ url: PNG_URI }] })
    await user.click(screen.getByRole('button', { name: 'Open image 1 of 1' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('hides navigation controls for a single image', async () => {
    const user = userEvent.setup()
    renderGallery({ images: [{ url: PNG_URI }] })
    await user.click(screen.getByRole('button', { name: 'Open image 1 of 1' }))
    expect(screen.queryByRole('button', { name: 'Next image' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Previous image' })).toBeNull()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('shows the loading spinner until the picture finishes loading', async () => {
    const user = userEvent.setup()
    renderGallery({ images: [{ url: REMOTE_URL }] })
    await user.click(screen.getByRole('button', { name: 'Open image 1 of 1' }))
    // jsdom never fires image load events, so the preview stays loading
    expect(screen.getByRole('status')).toBeInTheDocument()
    fireEvent.load(screen.getByRole('img', { name: 'Image Preview' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('falls back to the error text when the picture fails to load', async () => {
    const user = userEvent.setup()
    renderGallery({ images: [{ url: REMOTE_URL }] })
    await user.click(screen.getByRole('button', { name: 'Open image 1 of 1' }))
    fireEvent.error(screen.getByRole('img', { name: 'Image Preview' }))
    expect(screen.getByText('Failed to load image')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('falls back to the count badge when no image is renderable', () => {
    renderGallery({ images: [], totalCount: 3 })
    expect(screen.getByText('3 images')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open image/ })).toBeNull()
  })

  test('renders nothing when the message carries no images', () => {
    const { container } = renderGallery({ images: [] })
    expect(container).toBeEmptyDOMElement()
  })
})
