import { IconLock, IconMessageChatbot } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import { errorMessage } from '../hooks/useSupportChat'
import { Button, focusRing, inputClass } from './ui'

// Seeded demo customers (see README) so reviewers can try each scenario quickly.
const DEMO_ACCOUNTS = [
  { email: 'ada.okafor@example.com', orderNumber: 'WN-7K3P9Q', note: 'Damaged shirt' },
  { email: 'grace.lee@example.com', orderNumber: 'WN-4GK1VS', note: 'Two shirts, one return' },
  { email: 'kemi.adeyemi@example.com', orderNumber: 'WN-3VH9TL', note: 'Includes a final-sale item' },
  { email: 'efe.adebayo@example.com', orderNumber: 'WN-L6W9PH', note: 'Order over $500' },
]

export function SignInPage({ onSignedIn }: { onSignedIn: (firstName: string) => void }) {
  const [email, setEmail] = useState('')
  const [orderNumber, setOrderNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { firstName } = await api.signIn(email.trim(), orderNumber.trim())
      onSignedIn(firstName)
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "We couldn't find an order with that email and order number." : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <IconMessageChatbot size={24} aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Refund support</h1>
          <p className="text-sm text-slate-600">Sign in with your email and any order number.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Email</span>
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Order number</span>
          <input
            required
            placeholder="WN-XXXXXX"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value.toUpperCase())}
            className={`mt-1 w-full font-mono uppercase ${inputClass}`}
          />
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
        <Button type="submit" icon={IconLock} busy={busy} disabled={busy} className="w-full py-2.5">
          Continue
        </Button>
      </form>

      <section className="mt-6" aria-label="Demo accounts">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Demo accounts</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.email}>
              <button
                type="button"
                onClick={() => {
                  setEmail(account.email)
                  setOrderNumber(account.orderNumber)
                }}
                className={`w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-indigo-300 ${focusRing}`}
              >
                <span className="block font-medium">{account.note}</span>
                <span className="block truncate text-xs text-slate-500">
                  {account.email} · {account.orderNumber}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
