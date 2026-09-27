import { IconKey, IconShieldLock } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { adminApi, ApiError } from '../../api/client'
import { errorMessage } from '../../hooks/useSupportChat'
import { Alert, Button, inputClass, SignInLayout } from '../ui'

export function AdminLogin({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await adminApi(token.trim()).metrics()
      onSignedIn(token.trim())
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? 'That token was not accepted.' : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SignInLayout icon={IconShieldLock} iconClassName="bg-slate-800" title="Support dashboard" subtitle="Enter the admin token. It stays in this tab only." onSubmit={handleSubmit}>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Admin token</span>
        <input type="password" required autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className={`mt-1 w-full font-mono ${inputClass}`} />
      </label>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" icon={IconKey} busy={busy} disabled={busy} className="w-full py-2.5">
        Open dashboard
      </Button>
      <p className="text-xs text-slate-500">
        Demo token: <code className="font-mono">admin-demo-token</code> (set <code className="font-mono">ADMIN_TOKEN</code> to change it).
      </p>
    </SignInLayout>
  )
}
