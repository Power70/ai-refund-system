import { IconLock, IconMessageChatbot } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import { errorMessage } from '../hooks/useSupportChat'
import { Alert, Button, focusRing, inputClass, SignInLayout } from './ui'

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
    <SignInLayout
      icon={IconMessageChatbot}
      iconClassName="bg-indigo-600"
      title="Refund support"
      subtitle="Sign in with your email and any order number."
      onSubmit={handleSubmit}
      after={
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
      }
    >
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
      {error && <Alert>{error}</Alert>}
      <Button type="submit" icon={IconLock} busy={busy} disabled={busy} className="w-full py-2.5">
        Continue
      </Button>
    </SignInLayout>
  )
}
