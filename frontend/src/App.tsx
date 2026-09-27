import { IconLayoutDashboard, IconMessageChatbot, IconMessages } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { api } from './api/client'
import { AdminDashboard } from './components/admin/AdminDashboard'
import { AdminLogin } from './components/admin/AdminLogin'
import { ApiStatusBadge } from './components/ApiStatusBadge'
import { SignInPage } from './components/SignInPage'
import { SupportWorkspace } from './components/SupportWorkspace'
import { focusRing } from './components/ui'
import { useApiHealth } from './hooks/usePolledData'

type Session = { state: 'checking' } | { state: 'signed-out' } | { state: 'signed-in'; firstName: string }

const ADMIN_HASH = '#/admin'
const useIsAdminRoute = () => {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash === ADMIN_HASH
}

function App() {
  const apiHealth = useApiHealth()
  const isAdmin = useIsAdminRoute()
  const [session, setSession] = useState<Session>({ state: 'checking' })
  // Admin token lives in memory only: closing or reloading the tab signs the reviewer out.
  const [adminToken, setAdminToken] = useState<string | null>(null)

  useEffect(() => {
    api
      .currentSession()
      .then(({ firstName }) => setSession({ state: 'signed-in', firstName }))
      .catch(() => setSession({ state: 'signed-out' }))
  }, [])

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="h-16 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-2 px-4">
          <span className="flex items-center gap-2 font-semibold">
            <IconMessageChatbot size={22} className="text-indigo-600" aria-hidden="true" /> Refund Support
          </span>
          <div className="flex items-center gap-2">
            <a href={isAdmin ? '#/' : ADMIN_HASH} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-100 ${focusRing}`}>
              {isAdmin ? <IconMessages size={16} aria-hidden="true" /> : <IconLayoutDashboard size={16} aria-hidden="true" />}
              <span className="hidden sm:inline">{isAdmin ? 'Customer view' : 'Support dashboard'}</span>
            </a>
            <ApiStatusBadge state={apiHealth} />
          </div>
        </div>
      </header>
      {isAdmin ? (
        adminToken ? (
          <AdminDashboard token={adminToken} onSignedOut={() => setAdminToken(null)} />
        ) : (
          <AdminLogin onSignedIn={setAdminToken} />
        )
      ) : session.state === 'signed-in' ? (
        <SupportWorkspace firstName={session.firstName} onSignedOut={() => setSession({ state: 'signed-out' })} />
      ) : session.state === 'signed-out' ? (
        <SignInPage onSignedIn={(firstName) => setSession({ state: 'signed-in', firstName })} />
      ) : null}
    </div>
  )
}

export default App
