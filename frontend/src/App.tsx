import { IconLogout, IconMessageChatbot } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { adminApi, api } from './api/client'
import { AdminDashboard } from './components/admin/AdminDashboard'
import { AdminLogin } from './components/admin/AdminLogin'
import { ConnectionNotice } from './components/ConnectionNotice'
import { SignInPage } from './components/SignInPage'
import { SupportWorkspace } from './components/SupportWorkspace'
import { Button } from './components/ui'
import { useApiHealth } from './hooks/usePolledData'
import { storeId } from './hooks/useSupportChat'

type Session = { state: 'checking' } | { state: 'signed-out' } | { state: 'signed-in'; firstName: string }
type AdminSession = 'checking' | 'signed-out' | 'signed-in'

const isAdminHash = () => window.location.hash === '#/admin' || window.location.hash.startsWith('#/admin/')
const useIsAdminRoute = () => {
  const [admin, setAdmin] = useState(isAdminHash)
  useEffect(() => {
    const onChange = () => setAdmin(isAdminHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return admin
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

  const signOutCustomer = () => {
    void api
      .signOut()
      .catch(() => undefined)
      .finally(() => {
        storeId(null)
        setSession({ state: 'signed-out' })
      })
  }
  const signOutAdmin = () => void adminApi.signOut().catch(() => undefined).finally(() => setAdminSession('signed-out'))

  const account =
    isAdmin && adminSession === 'signed-in'
      ? { name: 'Support team', signOut: signOutAdmin }
      : !isAdmin && session.state === 'signed-in'
        ? { name: session.firstName, signOut: signOutCustomer }
        : null

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <ConnectionNotice state={apiHealth} />
      <header className="h-16 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-2 px-4">
          <span className="flex items-center gap-2 font-semibold">
            <IconMessageChatbot size={22} className="text-indigo-600" aria-hidden="true" /> Refund Support
          </span>
          {account && (
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="hidden truncate text-slate-600 sm:inline">{account.name}</span>
              <Button variant="ghost" icon={IconLogout} onClick={account.signOut}>
                Sign out
              </Button>
            </div>
          )}
        </div>
      </header>
      {isAdmin ? (
        adminSession === 'signed-in' ? (
          <AdminDashboard onSignedOut={() => setAdminSession('signed-out')} />
        ) : adminSession === 'signed-out' ? (
          <AdminLogin onSignedIn={() => setAdminSession('signed-in')} />
        ) : null
      ) : session.state === 'signed-in' ? (
        <SupportWorkspace firstName={session.firstName} />
      ) : session.state === 'signed-out' ? (
        <SignInPage onSignedIn={(firstName) => setSession({ state: 'signed-in', firstName })} />
      ) : null}
    </div>
  )
}

export default App
