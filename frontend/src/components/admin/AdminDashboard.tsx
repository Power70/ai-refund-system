import { IconInbox, IconUsers, type Icon } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { adminApi, ApiError, type AiStatus } from '../../api/client'
import { usePolledData } from '../../hooks/usePolledData'
import { focusRing, StatusDot } from '../ui'
import { CustomersView } from './CustomersView'
import { REFRESH_MS, RequestsView } from './RequestsView'

type Section = 'requests' | 'customers'

const SECTIONS: { id: Section; label: string; icon: Icon; hash: string }[] = [
  { id: 'requests', label: 'Refund requests', icon: IconInbox, hash: '#/admin' },
  { id: 'customers', label: 'Customers', icon: IconUsers, hash: '#/admin/customers' },
]

const sectionFromHash = (): Section => SECTIONS.find((s) => s.hash === window.location.hash)?.id ?? 'requests'

/** The section in the address, so a reload keeps it. */
function useSection(): Section {
  const [section, setSection] = useState(sectionFromHash)
  useEffect(() => {
    const onChange = () => setSection(sectionFromHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return section
}

/** Support dashboard: sections on the left (a tab row on phones), the chosen one on the right. */
export function AdminDashboard({ onSignedOut }: { onSignedOut: () => void }) {
  const section = useSection()
  const metrics = usePolledData(() => adminApi.metrics(), 'metrics', REFRESH_MS)

  const unauthorized = metrics.error instanceof ApiError && metrics.error.status === 401
  useEffect(() => {
    if (unauthorized) onSignedOut()
  }, [unauthorized, onSignedOut])

  return (
    <div className="mx-auto max-w-6xl p-3 sm:p-4 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6">
      <nav aria-label="Dashboard sections" className="mb-4 lg:mb-0">
        <ul className="flex gap-1 rounded-xl bg-slate-200/70 p-1 lg:sticky lg:top-4 lg:flex-col lg:bg-transparent lg:p-0">
          {SECTIONS.map(({ id, label, icon: SectionIcon, hash }) => (
            <li key={id} className="flex-1 lg:flex-none">
              <a
                href={hash}
                aria-current={section === id ? 'page' : undefined}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm lg:justify-start ${focusRing} ${
                  section === id ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
                }`}
              >
                <SectionIcon size={18} aria-hidden="true" /> {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <main className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">Support dashboard</h1>
          {metrics.data && <AiDot ai={metrics.data.ai} />}
        </div>
        {section === 'requests' ? <RequestsView metrics={metrics} onUnauthorized={onSignedOut} /> : <CustomersView onUnauthorized={onSignedOut} />}
      </main>
    </div>
  )
}

const AI_DOT = {
  ok: { tone: 'ok', label: 'AI online' },
  degraded: { tone: 'warning', label: 'AI degraded' },
  disabled: { tone: 'off', label: 'AI off' },
} as const

function AiDot({ ai }: { ai: AiStatus }) {
  const details = ai.status === 'disabled' ? 'No AI key configured' : [ai.provider && `${ai.provider} · ${ai.model}`, ai.lastError].filter(Boolean).join(' — ')
  return <StatusDot {...AI_DOT[ai.status]} details={details} />
}
