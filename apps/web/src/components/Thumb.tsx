import { useState } from 'react'
import { useUiSettings } from '@/api/settings'
import { cn } from '@/lib/utils'

/**
 * Optional small card thumbnail. Off by default (text first); when enabled it loads lazily and never reserves more
 * than a fixed box, so the list never waits for images.
 */
export function Thumb({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  const { thumbnails } = useUiSettings()
  const [failed, setFailed] = useState(false)
  if (!thumbnails || !src || failed) return null
  return (
    <img
      src={src}
      alt={alt}
      width={36}
      height={50}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn('h-[50px] w-9 shrink-0 rounded bg-muted object-cover', className)}
    />
  )
}
