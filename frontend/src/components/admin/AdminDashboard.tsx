import {
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconCircleX,
  IconClockHour4,
  IconInbox,
  IconLogout,
  IconRefresh,
  IconSearch,
  type Icon,
} from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { adminApi, ApiError, type AdminMetrics, type AiStatus, type QueueRow, type QueueView, type RequestStatus } from '../../api/client'
import { usePolledData } from '../../hooks/usePolledData'
import { formatCode, formatDate, formatMoney, formatTime } from '../../lib/format'
import { StatusBadge } from '../StatusBadge'
import { Button, focusRing, inputClass, pillClass, StatusDot } from '../ui'
import { CaseBriefSheet } from './CaseBriefSheet'

const REFRESH_MS = 10_000
const PAGE_SIZE = 20
const STATUSES: RequestStatus[] = ['APPROVED', 'DENIED', 'ESCALATED', 'PROCESSING']

export function AdminDashboard({ token, onSignedOut }: { token: string; onSignedOut: () => void }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [view, setView] = useState<QueueView>('needs-review')
  const [status, setStatus] = useState<RequestStatus | ''>('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)

  // Debounce typing before querying.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const metrics = usePolledData(() => admin.metrics(), token, REFRESH_MS)
  const queue = usePolledData(
    () => admin.queue({ view, status: view === 'all' && status ? status : undefined, q: q || undefined, page, pageSize: PAGE_SIZE }),
    `${token}|${view}|${status}|${q}|${page}`,
    REFRESH_MS,
  )

  const unauthorized = [metrics.error, queue.error].some((e) => e instanceof ApiError && e.status === 401)
  useEffect(() => {
    if (unauthorized) onSignedOut()
  }, [unauthorized, onSignedOut])

  const rows = queue.data?.items ?? []
  const total = queue.data?.total ?? 0
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1

  const switchView = (next: QueueView) => {
    setView(next)
    setPage(1)
  }

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">Support dashboard</h1>
          {metrics.data && <AiDot ai={metrics.data.ai} />}
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-500 sm:gap-2">
          {metrics.data && <span className="hidden sm:inline">Updated {formatTime(metrics.data.generatedAt)}</span>}
          <Button variant="icon" icon={IconRefresh} aria-label="Refresh now" onClick={() => (metrics.reload(), queue.reload())} />
          <Button variant="ghost" icon={IconLogout} onClick={onSignedOut} aria-label="Sign out" title="Sign out">
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </div>

      {metrics.data ? <MetricsTiles metrics={metrics.data} /> : <p className="text-sm text-slate-500">Loading metrics…</p>}

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
        </div>

        {queue.error && !unauthorized ? (
          <p role="alert" className="flex items-center gap-2 px-4 py-6 text-sm text-rose-700">
            <IconAlertTriangle size={18} aria-hidden="true" /> Couldn't load requests. Retrying automatically.
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">{queue.data ? (view === 'needs-review' ? 'Nothing is waiting for review.' : 'No requests match.') : 'Loading…'}</p>
        ) : (
          <QueueList rows={rows} onOpen={setOpenId} />
        )}

        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-sm text-slate-600">
          <span>
            {first}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-1">
            <Button variant="icon" icon={IconChevronLeft} aria-label="Previous page" disabled={page === 1} onClick={() => setPage((p) => p - 1)} />
            <Button variant="icon" icon={IconChevronRight} aria-label="Next page" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)} />
          </div>
        </div>
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
    </main>
  )
}

function MetricsTiles({ metrics }: { metrics: AdminMetrics }) {
  const { requests } = metrics
  return (
    <section aria-label="Metrics" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile className="col-span-2 sm:col-span-1" icon={IconInbox} label="Requests" value={requests.total} detail={`${requests.last24Hours} in last 24h`} />
        <Tile icon={IconCircleCheck} label="Auto-approved" value={requests.approved} tone="text-emerald-700" />
        <Tile icon={IconCircleX} label="Denied" value={requests.denied} tone="text-rose-700" />
        <Tile icon={IconClockHour4} label="Awaiting review" value={requests.awaitingReview} detail={`${requests.escalated} escalated in total`} tone="text-amber-700" />
        <Tile
          icon={IconAlertTriangle}
          label="Stuck requests"
          value={metrics.stuckProcessingCount}
          detail="Expected 0"
          tone={metrics.stuckProcessingCount > 0 ? 'text-rose-700' : 'text-slate-700'}
        />
      </div>
      {metrics.topEscalationReasons.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Top escalation reasons:</span>
          {metrics.topEscalationReasons.map((r) => (
            <span key={r.reason} className={`${pillClass} border-slate-200 bg-white py-0.5`}>
              {formatCode(r.reason)} <span className="text-slate-500">{r.count}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

function Tile({ icon: TileIcon, label, value, detail, tone = 'text-slate-900', className = '' }: { icon: Icon; label: string; value: string | number; detail?: string; tone?: string; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-3 ${className}`}>
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <TileIcon size={14} aria-hidden="true" /> {label}
      </p>
      <p className={`mt-1 text-xl font-semibold ${tone}`}>{value}</p>
      {detail && <p className="truncate text-xs text-slate-500">{detail}</p>}
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
