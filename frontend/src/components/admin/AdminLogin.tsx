import { IconLock, IconShieldLock } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { adminApi, ApiError } from '../../api/client'
import { errorMessage } from '../../hooks/useSupportChat'
import { Alert, Button, inputClass, SignInLayout } from '../ui'

export function AdminLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await adminApi.signIn(password)
      onSignedIn()
    } catch (e) {
      setError(e instanceof ApiError && (e.status === 401 || e.status === 400) ? 'Invalid credentials.' : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SignInLayout icon={IconShieldLock} iconClassName="bg-slate-800" title="Support dashboard" subtitle="Enter the admin password to open the dashboard." onSubmit={handleSubmit} switchLink={{ href: '#/', label: 'Customer? Go to customer sign-in' }}>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Password</span>
        <input type="password" required maxLength={200} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`mt-1 w-full ${inputClass}`} />
      </label>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" icon={IconLock} busy={busy} disabled={busy} className="w-full py-2.5">
        Open dashboard
      </Button>
    </SignInLayout>
  )
}
