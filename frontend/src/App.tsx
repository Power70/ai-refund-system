import { ApiStatusBadge } from './components/ApiStatusBadge'
import { useApiHealth } from './hooks/useApiHealth'

function App() {
  const apiHealth = useApiHealth()

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <h1 className="text-lg font-semibold">Refund Support</h1>
          <ApiStatusBadge state={apiHealth} />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-slate-600">
          The customer assistant and the support dashboard are being built. This page confirms the
          frontend can reach the API through the proxy.
        </p>
      </main>
    </div>
  )
}

export default App
