import { IconLock, IconMessageChatbot } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import { errorMessage } from '../hooks/useSupportChat'
import { Alert, Button, inputClass, SignInLayout } from './ui'

export function SignInPage({ onSignedIn }: { onSignedIn: (firstName: string) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { firstName } = await api.signIn(email.trim(), password)
      onSignedIn(firstName)
    } catch (e) {
      setError(e instanceof ApiError && (e.status === 401 || e.status === 400) ? 'Invalid credentials.' : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SignInLayout
      icon={IconMessageChatbot}
      iconClassName="bg-indigo-600"
      title="Refund support"
      subtitle="Sign in with your email and password."
      onSubmit={handleSubmit}
    >
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Email</span>
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Password</span>
        <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
      </label>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" icon={IconLock} busy={busy} disabled={busy} className="w-full py-2.5">
        Sign in
      </Button>
    </SignInLayout>
  )
}
