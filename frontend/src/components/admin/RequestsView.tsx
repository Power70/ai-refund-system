import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconClockHour4,
  IconInbox,
  IconRefresh,
  IconSearch,
  type Icon,
} from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { adminApi, ApiError, type AdminMetrics, type QueueRow, type QueueView, type RequestStatus } from '../../api/client'
import { useDebouncedValue, usePolledData, type PolledData } from '../../hooks/usePolledData'
import { formatCode, formatDate, formatMoney, formatTime } from '../../lib/format'
import { StatusBadge } from '../StatusBadge'
import { Button, focusRing, inputClass, Pager, pillClass } from '../ui'
import { CaseBriefSheet } from './CaseBriefSheet'

export const REFRESH_MS = 10_000
export const PAGE_SIZE = 10
const STATUSES: RequestStatus[] = ['APPROVED', 'DENIED', 'ESCALATED', 'PROCESSING']

interface RequestsViewProps {
  /** Polled by the dashboard, which also shows the AI status from it. */
  metrics: PolledData<AdminMetrics>
  onUnauthorized: () => void
}

/** Counters and the refund request queue. */
export function RequestsView({ metrics, onUnauthorized }: RequestsViewProps) {
  const admin = adminApi
  const [view, setView] = useState<QueueView>('needs-review')
  const [status, setStatus] = useState<RequestStatus | ''>('')
  const [search, setSearch] = useState('')
  const q = useDebouncedValue(search.trim())
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)

  // A new search starts from the first page.
  const [searched, setSearched] = useState(q)
  if (searched !== q) {
    setSearched(q)
    setPage(1)
  }

  const queue = usePolledData(
    () => admin.queue({ view, status: view === 'all' && status ? status : undefined, q: q || undefined, page, pageSize: PAGE_SIZE }),
    `${view}|${status}|${q}|${page}`,
    REFRESH_MS,
  )

  const unauthorized = queue.error instanceof ApiError && queue.error.status === 401
  useEffect(() => {
    if (unauthorized) onUnauthorized()
  }, [unauthorized, onUnauthorized])

  const rows = queue.data?.items ?? []
  const pages = Math.max(1, Math.ceil((queue.data?.total ?? 0) / PAGE_SIZE))

  const switchView = (next: QueueView) => {
    setView(next)
    setPage(1)
  }

  return (
    <div className="space-y-4">
      {metrics.data ? <MetricsTiles metrics={metrics.data} /> : <div className="h-20" aria-hidden="true" />}

      <section aria-label="Refund requests" className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
          <div role="tablist" aria-label="Queue" className="flex w-full rounded-lg bg-slate-100 p-1 sm:w-auto">
            {(['needs-review', 'all'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => switchView(v)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm whitespace-nowrap sm:flex-none ${view === v ? 'bg-white font-medium shadow-sm' : 'text-slate-600'}`}
              >
                {v === 'needs-review' ? `Needs review${metrics.data ? ` (${metrics.data.requests.awaitingReview})` : ''}` : 'All recent'}
              </button>
            ))}
          </div>
          {view === 'all' && (
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as RequestStatus | '')
                setPage(1)
              }}
              className={`w-full text-sm sm:w-auto ${inputClass}`}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {formatCode(s)}
                </option>
              ))}
            </select>
          )}
          <label className="relative ml-auto w-full sm:w-72">
            <span className="sr-only">Search requests</span>
            <IconSearch size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Request, order, name or email" className={`w-full pl-9 text-sm ${inputClass}`} />
          </label>
          <Button variant="icon" icon={IconRefresh} aria-label="Refresh now" title={metrics.data ? `Updated ${formatTime(metrics.data.generatedAt)}` : undefined} onClick={() => (metrics.reload(), queue.reload())} />
        </div>

        {/* Keeps its height while a new view loads; the previous rows stay, dimmed, until the new ones arrive. */}
        <div aria-busy={queue.loading} className="min-h-48">
          {queue.error && !queue.data && !unauthorized ? (
            <p role="alert" className="flex items-center gap-2 px-4 py-6 text-sm text-rose-700">
              <IconAlertTriangle size={18} aria-hidden="true" /> Couldn't load requests. Retrying automatically.
            </p>
          ) : !queue.data ? (
            <QueueSkeleton />
          ) : (
            <div key={`${view}|${status}|${q}|${page}`} className={`transition-opacity duration-200 ${queue.loading ? 'opacity-50' : 'animate-fade-in motion-reduce:animate-none'}`}>
              {rows.length === 0 ? (
                <p className="px-4 py-12 text-center text-sm text-slate-500">{view === 'needs-review' ? 'Nothing is waiting for review.' : 'No requests match.'}</p>
              ) : (
                <QueueList rows={rows} onOpen={setOpenId} />
              )}
            </div>
          )}
        </div>

        {rows.length > 0 && <Pager page={page} pages={pages} onPage={setPage} />}
      </section>

      {openId && (
        <CaseBriefSheet
          api={admin}
          requestId={openId}
          onClose={() => setOpenId(null)}
          onResolved={() => {
            metrics.reload()
            queue.reload()
          }}
        />
      )}
    </div>
  )
}

function MetricsTiles({ metrics }: { metrics: AdminMetrics }) {
  const { requests } = metrics
  return (
    <section aria-label="Metrics" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile className="col-span-2 sm:col-span-1" icon={IconInbox} label="Requests" value={requests.total} />
        <Tile icon={IconCircleCheck} label="Auto-approved" value={requests.approved} tone="text-emerald-700" />
        <Tile icon={IconCircleX} label="Denied" value={requests.denied} tone="text-rose-700" />
        <Tile icon={IconClockHour4} label="Awaiting review" value={requests.awaitingReview} tone="text-amber-700" />
        <Tile icon={IconAlertTriangle} label="Stuck requests" value={metrics.stuckProcessingCount} tone={metrics.stuckProcessingCount > 0 ? 'text-rose-700' : 'text-slate-700'} />
      </div>
      {metrics.topEscalationReasons.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Top escalation reasons:</span>
          {metrics.topEscalationReasons.map((r) => (
            <span key={r.reason} className={`${pillClass} border-slate-200 bg-white py-0.5`}>
              {formatCode(r.reason)}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

function Tile({ icon: TileIcon, label, value, tone = 'text-slate-900', className = '' }: { icon: Icon; label: string; value: number; tone?: string; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-3 ${className}`}>
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <TileIcon size={14} aria-hidden="true" /> {label}
      </p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  )
}

/** Placeholder rows shown before the first load, shaped like the real ones. */
function QueueSkeleton() {
  return (
    <ul aria-label="Loading requests" className="divide-y divide-slate-100">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex animate-pulse items-center gap-4 px-4 py-4 motion-reduce:animate-none">
          <span className="h-3 w-32 rounded bg-slate-200" />
          <span className="h-3 flex-1 rounded bg-slate-100" />
          <span className="hidden h-5 w-20 rounded-full bg-slate-100 md:block" />
        </li>
      ))}
    </ul>
  )
}

const QUEUE_COLUMNS = 'md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_6rem_8rem_minmax(0,1.4fr)] md:items-center md:gap-4'

/** Queue rows: stacked cards on phones, table-like columns from `md` up. */
function QueueList({ rows, onOpen }: { rows: QueueRow[]; onOpen: (requestId: string) => void }) {
  return (
    <div className="text-sm">
      <div aria-hidden="true" className={`hidden px-4 py-2 text-xs font-medium text-slate-500 uppercase ${QUEUE_COLUMNS}`}>
        <span>Request</span>
        <span>Customer</span>
        <span>Amount</span>
        <span>Outcome</span>
        <span>Why</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((row) => (
          <li key={row.requestId}>
            <button type="button" onClick={() => onOpen(row.requestId)} className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${focusRing} ${QUEUE_COLUMNS}`}>
              <span className="flex items-start justify-between gap-3 md:block">
                <span className="block min-w-0">
                  <span className="block truncate font-mono text-xs text-indigo-700">{row.requestId}</span>
                  <span className="block text-xs text-slate-500">
                    {formatDate(row.createdAt)} · {row.orderNumber}
                    {row.source === 'SEED' && <span className="ml-1 rounded bg-slate-100 px-1 text-[11px]">demo history</span>}
                  </span>
                </span>
                <span className="shrink-0 font-medium tabular-nums md:hidden">{formatMoney(row.requestedAmountMinor)}</span>
              </span>
              <span className="mt-2 block min-w-0 md:mt-0">
                <span className="block truncate">{row.customerName}</span>
                <span className="block truncate text-xs text-slate-500">{row.customerEmail}</span>
              </span>
              <span className="hidden tabular-nums md:block">{formatMoney(row.requestedAmountMinor)}</span>
              <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 md:mt-0 md:flex-col md:items-start">
                <StatusBadge status={row.status} />
                {row.resolution && <span className="text-xs text-slate-500">Resolved: {formatCode(row.resolution)}</span>}
              </span>
              <span className="mt-2 flex flex-wrap gap-1 md:mt-0">
                {row.reasons.map((r) => (
                  <span key={r} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                    {formatCode(r)}
                  </span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
