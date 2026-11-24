import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The buttons a page keeps in reach however long it gets: a bar with the look of the shell's fixed row that stays in
 * the page's own flow, stuck right above the tab bar. It is not the fixed row and not a portal into it: a submit has
 * to stay inside its <form>, and the buttons keep their place in the page's reading and focus order. A screen with
 * this bar has no fixed row of the shell.
 */
export function StickyActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-slot="sticky-actions"
      className={cn(
        // The children are the page's own buttons: they take the row's height (48 px inside it) and its inner radius.
        'sticky bottom-[calc(var(--bar-h)+8px+env(safe-area-inset-bottom))] z-20 flex h-(--row-h) items-center gap-1.5 rounded-[20px] border border-input bg-row p-[5px] shadow-(--shadow-row) *:h-12 *:rounded-[15px]',
        className,
      )}
    >
      {children}
    </div>
  )
}
