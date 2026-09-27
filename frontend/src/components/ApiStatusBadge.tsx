import { IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react'
import type { ApiHealthState } from '../hooks/usePolledData'
import { Spinner } from './ui'

interface ApiStatusBadgeProps {
  state: ApiHealthState
}

const LABELS: Record<ApiHealthState, string> = {
  checking: 'Connecting…',
  ok: 'Service online',
  degraded: 'Service degraded',
  unreachable: 'Service unreachable',
}

export function ApiStatusBadge({ state }: ApiStatusBadgeProps) {
  const tone =
    state === 'ok'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : state === 'checking'
        ? 'bg-slate-50 text-slate-600 ring-slate-200'
        : 'bg-amber-50 text-amber-800 ring-amber-200'

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ring-1 ${tone}`}
    >
      {state === 'ok' && <IconCircleCheck size={16} aria-hidden="true" />}
      {state === 'checking' && <Spinner />}
      {(state === 'degraded' || state === 'unreachable') && <IconAlertTriangle size={16} aria-hidden="true" />}
      {LABELS[state]}
    </span>
  )
}
