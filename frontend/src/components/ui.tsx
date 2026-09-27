import { IconLoader2, type Icon } from '@tabler/icons-react'
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
