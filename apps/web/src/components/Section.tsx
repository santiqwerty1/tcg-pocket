import { ChevronDownIcon } from 'lucide-react'
import { createContext, type ReactNode, useContext, useState } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'

/** Inside a `Fold` the fold's summary is the title: a `Section` there shows only its action. */
const InFold = createContext(false)

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  const folded = useContext(InFold)
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      {folded ? (
        action ? (
          <div className="flex justify-end">{action}</div>
        ) : null
      ) : (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

function readOpen(key: string | undefined): boolean {
  if (!key) return false
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

/**
 * A section that starts closed and mounts its content the first time it opens (Fase 41): what the content fetches is
 * fetched then, not when the page loads. With `remember`, whether it stays open is kept on this device.
 */
export function Fold({
  id,
  title,
  hint,
  remember,
  children,
}: {
  id?: string
  title: string
  /** One line next to the title, e.g. a count. */
  hint?: ReactNode
  /** localStorage key for the open state. */
  remember?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => readOpen(remember))
  const [mounted, setMounted] = useState(open)
  return (
    <details
      id={id}
      open={open}
      className="group rounded-lg border"
      onToggle={(event) => {
        const next = event.currentTarget.open
        setOpen(next)
        if (next) setMounted(true)
        if (remember) {
          try {
            localStorage.setItem(remember, next ? '1' : '0')
          } catch {
            // Storage blocked: it just starts closed next time.
          }
        }
      }}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2 select-none [&::-webkit-details-marker]:hidden">
        <h2 className="min-w-0 flex-1 text-lg font-semibold">{title}</h2>
        {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
        <ChevronDownIcon
          className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      {mounted ? (
        <div className="border-t px-3 pt-2 pb-3">
          <InFold.Provider value={true}>{children}</InFold.Provider>
        </div>
      ) : null}
    </details>
  )
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Card id as a monospace code; optionally links to the card page. */
export function CardCode({ id, link = true, className }: { id: string; link?: boolean; className?: string }) {
  const code = <code className={cn('rounded bg-muted px-1 font-mono text-xs', className)}>{id}</code>
  if (!link) return code
  return (
    <Link to={`/cartas/${encodeURIComponent(id)}`} className="hover:underline">
      {code}
    </Link>
  )
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
