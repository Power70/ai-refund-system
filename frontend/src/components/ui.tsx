import { IconAlertTriangle, IconLoader2, IconRefresh, IconX, type Icon } from '@tabler/icons-react'
import { useEffect, useRef, type ComponentProps, type FormEvent, type ReactNode } from 'react'

export const focusRing = 'focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:outline-none'
export const inputClass = 'rounded-lg border border-slate-300 px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none'
export const pillClass = `rounded-full border px-3 py-1.5 text-sm ${focusRing}`

const BUTTON_VARIANTS = {
  primary: 'justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50',
  ghost: 'gap-1 rounded-lg px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-100',
  icon: 'justify-center rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40',
  send: 'size-10 shrink-0 justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50',
}

export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <IconLoader2 size={size} aria-hidden="true" className={`animate-spin motion-reduce:animate-none ${className}`} />
}

interface ButtonProps extends ComponentProps<'button'> {
  variant?: keyof typeof BUTTON_VARIANTS
  icon?: Icon
  busy?: boolean
}

export function Button({ variant = 'primary', icon: ButtonIcon, busy = false, className = '', children, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} {...props} className={`inline-flex items-center ${BUTTON_VARIANTS[variant]} ${focusRing} ${className}`}>
      {busy ? <Spinner /> : ButtonIcon && <ButtonIcon size={variant === 'primary' || variant === 'ghost' ? 16 : 18} aria-hidden="true" />}
      {children}
    </button>
  )
}

/** Side panel with an icon heading. */
export function Panel({ id, icon: PanelIcon, title, children }: { id: string; icon: Icon; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-slate-200 bg-white">
      <h2 id={id} className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm font-semibold">
        <PanelIcon size={18} aria-hidden="true" /> {title}
      </h2>
      {children}
    </section>
  )
}

export function PanelMessage({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-sm text-slate-500">{children}</p>
}

/** A load failure with a way to try again. */
export function LoadError({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 text-sm text-rose-700">
      <span className="flex items-center gap-2">
        <IconAlertTriangle size={18} aria-hidden="true" /> {children}
      </span>
      <Button variant="ghost" icon={IconRefresh} onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

/** A card shown inside the chat thread. Takes focus (without scrolling) when shown or when `focusKey` changes. */
export function ChatCard({ labelledBy, focusKey, className = 'border-slate-200', children }: { labelledBy: string; focusKey?: string; className?: string; children: ReactNode }) {
  const card = useRef<HTMLElement>(null)
  useEffect(() => card.current?.focus({ preventScroll: true }), [focusKey])
  return (
    <section ref={card} tabIndex={-1} aria-labelledby={labelledBy} className={`rounded-2xl border bg-white p-4 shadow-sm focus:outline-none sm:ml-10 ${className}`}>
      {children}
    </section>
  )
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {children}
    </p>
  )
}

interface SignInLayoutProps {
  icon: Icon
  iconClassName: string
  title: string
  subtitle: string
  onSubmit: (event: FormEvent) => void
  children: ReactNode
  after?: ReactNode
}

/** Centered sign-in form shared by the customer and admin entry pages. */
export function SignInLayout({ icon: HeaderIcon, iconClassName, title, subtitle, onSubmit, children, after }: SignInLayoutProps) {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <span className={`flex size-11 items-center justify-center rounded-xl text-white ${iconClassName}`}>
          <HeaderIcon size={24} aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-slate-600">{subtitle}</p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {children}
      </form>
      {after}
    </main>
  )
}

interface SheetProps {
  labelledBy: string
  /** Header content; must contain the element with id `labelledBy`. */
  title: ReactNode
  onClose: () => void
  children: ReactNode
}

/**
 * Modal sheet: full screen on phones, a right-hand panel from `sm` up. Escape or the backdrop
 * closes it; focus moves into it on open and returns to the trigger on close.
 */
export function Sheet({ labelledBy, title, onClose, children }: SheetProps) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Runs once: parents re-render on polling and must not steal focus back.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      trigger?.focus({ preventScroll: true })
    }
  }, [])

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col bg-slate-50 shadow-xl sm:max-w-2xl"
      >
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">{title}</div>
          <Button variant="icon" icon={IconX} aria-label="Close" onClick={onClose} ref={closeButton} />
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">{children}</div>
      </aside>
    </div>
  )
}

const DOT_TONES = {
  ok: 'bg-emerald-500',
  warning: 'bg-amber-500',
  off: 'bg-slate-400',
}

/** A coloured dot with a short label, for at-a-glance status. `details` shows on hover and to screen readers. */
export function StatusDot({ tone, label, details }: { tone: keyof typeof DOT_TONES; label: string; details?: string }) {
  return (
    <span role="status" title={details} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
      <span className="relative flex size-2" aria-hidden="true">
        {tone === 'ok' && <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden ${DOT_TONES.ok}`} />}
        <span className={`relative inline-flex size-2 rounded-full ${DOT_TONES[tone]}`} />
      </span>
      {label}
      {details && <span className="sr-only">: {details}</span>}
    </span>
  )
}
