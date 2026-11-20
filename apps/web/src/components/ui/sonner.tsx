import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useLook } from '@/lib/look'

// `!`: sonner's selectors (`[data-sonner-toast][data-styled=true] [data-button]`) outweigh a plain class.
const TOAST_BUTTON = 'text-xs! focus-visible:ring-2! focus-visible:ring-ring!'

/** Toasts follow the app's theme (Más → Ajustes de la app), and take their colours and their font from the tokens. */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolved } = useLook()
  return (
    <Sonner
      theme={resolved}
      position="top-center"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
          fontFamily: 'var(--font-sans)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
          // sonner writes the description in a grey of its own for each theme: it comes from the tokens instead.
          description: 'text-muted-foreground!',
          // sonner's own sheet writes its buttons («Deshacer») at 12 px with a black focus shadow, invisible on a dark
          // toast: the floor of `text-xs` and the app's ring instead.
          actionButton: TOAST_BUTTON,
          cancelButton: TOAST_BUTTON,
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
