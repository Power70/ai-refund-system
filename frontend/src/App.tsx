import { IconMessageChatbot } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { api } from './api/client'
import { ApiStatusBadge } from './components/ApiStatusBadge'
import { SignInPage } from './components/SignInPage'
import { SupportWorkspace } from './components/SupportWorkspace'
import { useApiHealth } from './hooks/useApiHealth'

type Session = { state: 'checking' } | { state: 'signed-out' } | { state: 'signed-in'; firstName: string }

function App() {
  const apiHealth = useApiHealth()
  const [session, setSession] = useState<Session>({ state: 'checking' })

  useEffect(() => {
    api
      .currentSession()
      .then(({ firstName }) => setSession({ state: 'signed-in', firstName }))
      .catch(() => setSession({ state: 'signed-out' }))
  }, [])

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="h-16 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-4">
          <span className="flex items-center gap-2 font-semibold">
            <IconMessageChatbot size={22} className="text-indigo-600" aria-hidden="true" /> Refund Support
          </span>
          <ApiStatusBadge state={apiHealth} />
        </div>
      </header>
      {session.state === 'signed-in' ? (
        <SupportWorkspace firstName={session.firstName} onSignedOut={() => setSession({ state: 'signed-out' })} />
      ) : session.state === 'signed-out' ? (
        <SignInPage onSignedIn={(firstName) => setSession({ state: 'signed-in', firstName })} />
      ) : null}
    </div>
  )
}

export default App
