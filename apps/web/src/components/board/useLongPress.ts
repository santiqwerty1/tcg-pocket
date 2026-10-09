import { type PointerEvent, useRef } from 'react'

/**
 * Tap and long press on the same element (Fase 22): a press held ~450 ms is a long press (the card, enlarged) and
 * the click that follows it is swallowed; a shorter one is a tap. Moving the finger (scrolling) cancels both.
 */
export function useLongPress(onTap: () => void, onLong: () => void, delay = 450) {
  const timer = useRef<number | null>(null)
  const fired = useRef(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  return {
    onPointerDown: (event: PointerEvent) => {
      fired.current = false
      start.current = { x: event.clientX, y: event.clientY }
      clear()
      timer.current = window.setTimeout(() => {
        fired.current = true
        onLong()
      }, delay)
    },
    onPointerMove: (event: PointerEvent) => {
      if (!start.current) return
      if (Math.abs(event.clientX - start.current.x) > 10 || Math.abs(event.clientY - start.current.y) > 10) clear()
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClick: () => {
      if (fired.current) {
        fired.current = false
        return
      }
      onTap()
    },
    onContextMenu: (event: { preventDefault: () => void }) => {
      // A long press on Android opens the context menu: the long press handles it.
      event.preventDefault()
    },
  }
}
