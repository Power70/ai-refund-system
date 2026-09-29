import type { ApiHealthState } from '../hooks/usePolledData'
import { Spinner } from './ui'

/** Appears only while the service can't be reached, and disappears once it is back. */
export function ConnectionNotice({ state }: { state: ApiHealthState }) {
  const down = state === 'unreachable' || state === 'degraded'
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
      <p
        className={`inline-flex items-center gap-2 rounded-full bg-slate-900/90 px-4 py-2 text-sm text-white shadow-lg transition duration-300 motion-reduce:transition-none ${
          down ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'
        }`}
      >
        {down && (
          <>
            <Spinner size={14} /> Connection lost. Trying to reconnect…
          </>
        )}
      </p>
    </div>
  )
}
