import { IconMessageChatbot } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { adminApi, api } from './api/client'
import { AdminDashboard } from './components/admin/AdminDashboard'
import { AdminLogin } from './components/admin/AdminLogin'
import { ConnectionNotice } from './components/ConnectionNotice'
import { SignInPage } from './components/SignInPage'
import { SupportWorkspace } from './components/SupportWorkspace'
import { useApiHealth } from './hooks/usePolledData'

type Session = { state: 'checking' } | { state: 'signed-out' } | { state: 'signed-in'; firstName: string }
type AdminSession = 'checking' | 'signed-out' | 'signed-in'

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
  // Both sessions live in httpOnly cookies; on load we only ask whether they are still valid.
  const [session, setSession] = useState<Session>({ state: 'checking' })
  const [adminSession, setAdminSession] = useState<AdminSession>('checking')

  useEffect(() => {
    if (isAdmin) {
      adminApi.currentSession().then(
        () => setAdminSession('signed-in'),
        () => setAdminSession('signed-out'),
      )
      return
    }
    api
      .currentSession()
      .then(({ firstName }) => setSession({ state: 'signed-in', firstName }))
      .catch(() => setSession({ state: 'signed-out' }))
  }, [isAdmin])

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <ConnectionNotice state={apiHealth} />
      <header className="h-16 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-full max-w-6xl items-center px-4">
          <span className="flex items-center gap-2 font-semibold">
            <IconMessageChatbot size={22} className="text-indigo-600" aria-hidden="true" /> Refund Support
          </span>
        </div>
      </header>
      {isAdmin ? (
        adminSession === 'signed-in' ? (
          <AdminDashboard onSignedOut={() => setAdminSession('signed-out')} />
        ) : adminSession === 'signed-out' ? (
          <AdminLogin onSignedIn={() => setAdminSession('signed-in')} />
        ) : null
      ) : session.state === 'signed-in' ? (
        <SupportWorkspace firstName={session.firstName} onSignedOut={() => setSession({ state: 'signed-out' })} />
      ) : session.state === 'signed-out' ? (
        <SignInPage onSignedIn={(firstName) => setSession({ state: 'signed-in', firstName })} />
      ) : null}
    </div>
  )
}

export default App
