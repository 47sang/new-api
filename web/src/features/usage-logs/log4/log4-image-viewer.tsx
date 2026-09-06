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
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
/**
 * Image gallery for the Log4 message detail pane: clickable thumbnails for
 * the message's renderable images plus a fullscreen lightbox preview. The
 * lightbox is a nested Base UI dialog, so Esc and dismissal only close the
 * preview and never the underlying detail dialog.
 */
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

import type { ParsedMessageImage } from './request-body'

const LIGHTBOX_CONTROL_CLASS =
  'flex size-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white'

/** Fullscreen preview of one message image, with prev/next navigation. */
function Log4ImageLightbox(props: {
  images: ParsedMessageImage[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const total = props.images.length
  const image = props.images[props.index]

  // Reset the load state whenever another image is shown.
  useEffect(() => {
    setIsLoading(true)
    setHasError(false)
  }, [image.url])

  // Wrap-around navigation, mirroring the thumbnail order.
  const moveBy = (delta: number) => {
    props.onIndexChange((props.index + delta + total) % total)
  }

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          className='fixed inset-0 z-[100] flex items-center justify-center bg-black/90 outline-none'
          onClick={(event) => {
            // Clicks that land on the black area itself (not on the picture
            // or the controls) close the preview.
            if (event.target === event.currentTarget) props.onClose()
          }}
          onKeyDown={(event) => {
            if (total < 2) return
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              moveBy(-1)
            } else if (event.key === 'ArrowRight') {
              event.preventDefault()
              moveBy(1)
            }
          }}
        >
          <DialogPrimitive.Title className='sr-only'>
            {t('Image Preview')}
          </DialogPrimitive.Title>
          <div className='relative flex max-h-full max-w-full items-center justify-center p-10'>
            {isLoading && !hasError && (
              <Spinner className='absolute size-6 text-white/70' />
            )}
            {hasError && (
              <span className='absolute text-sm text-white/70'>
                {t('Failed to load image')}
              </span>
            )}
            <img
              src={image.url}
              alt={t('Image Preview')}
              className={cn(
                'max-h-[85vh] max-w-[90vw] rounded-md object-contain',
                (isLoading || hasError) && 'opacity-0'
              )}
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setIsLoading(false)
                setHasError(true)
              }}
            />
            {total > 1 && (
              <span className='absolute bottom-2.5 left-1/2 -translate-x-1/2 text-xs text-white/70 tabular-nums'>
                {props.index + 1} / {total}
              </span>
            )}
          </div>
          {total > 1 && (
            <>
              <button
                type='button'
                onClick={() => moveBy(-1)}
                aria-label={t('Previous image')}
                className={cn(
                  'absolute top-1/2 left-3 -translate-y-1/2 rounded-full',
                  LIGHTBOX_CONTROL_CLASS
                )}
              >
                <ChevronLeft className='size-6' />
              </button>
              <button
                type='button'
                onClick={() => moveBy(1)}
                aria-label={t('Next image')}
                className={cn(
                  'absolute top-1/2 right-3 -translate-y-1/2 rounded-full',
                  LIGHTBOX_CONTROL_CLASS
                )}
              >
                <ChevronRight className='size-6' />
              </button>
            </>
          )}
          <DialogPrimitive.Close
            render={
              <button
                type='button'
                aria-label={t('Close')}
                className={cn('absolute top-3 right-3', LIGHTBOX_CONTROL_CLASS)}
              />
            }
          >
            <X className='size-5' />
          </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * Thumbnail row for the renderable images of one message; clicking a
 * thumbnail opens the fullscreen lightbox at that image.
 *
 * @param props.images - Renderable images from extractMessageImages
 * @param props.totalCount - Image count the parser reported, including
 *   non-renderable references; when nothing is renderable the original
 *   count badge is kept so auditors still see the turn carried images
 */
export function Log4ImageGallery(props: {
  images: ParsedMessageImage[]
  totalCount?: number
}) {
  const { t } = useTranslation()
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  // A different message passes a new images array; never keep a preview of
  // the previous message open.
  useEffect(() => {
    setOpenIndex(null)
  }, [props.images])

  if (props.images.length === 0) {
    if (props.totalCount) {
      return (
        <span className='text-muted-foreground bg-muted inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px]'>
          {t('{{count}} images', { count: props.totalCount })}
        </span>
      )
    }
    return null
  }

  return (
    <div className='flex max-w-full flex-wrap items-start gap-1.5'>
      {/* Precomputed keys keep the map callback free of index-based keys;
          data URLs are far too large to serve as keys directly, so the key
          mixes the position with short data-derived fragments. */}
      {props.images
        .map((image, position) => ({
          key: `image-${position}-${image.mediaType ?? 'unknown'}-${image.url.length}-${image.url.slice(-16)}`,
          image,
          position,
        }))
        .map((entry) => (
          <button
            key={entry.key}
            type='button'
            onClick={() => setOpenIndex(entry.position)}
            aria-label={t('Open image {{index}} of {{total}}', {
              index: entry.position + 1,
              total: props.images.length,
            })}
            className='focus-visible:ring-ring block shrink-0 overflow-hidden rounded-md border outline-none focus-visible:ring-2'
          >
            <img
              src={entry.image.url}
              alt=''
              className='size-20 object-cover'
              loading='lazy'
              decoding='async'
            />
          </button>
        ))}
      {openIndex !== null && (
        <Log4ImageLightbox
          images={props.images}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </div>
  )
}
