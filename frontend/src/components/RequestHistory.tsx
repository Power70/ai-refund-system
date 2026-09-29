import { IconChevronRight, IconHistory } from '@tabler/icons-react'
import type { RefundRequestView } from '../api/client'
import { formatDate, formatMoney } from '../lib/format'
import { StatusBadge } from './StatusBadge'
import { focusRing, LoadError, Panel, PanelMessage } from './ui'

interface RequestHistoryProps {
  requests: RefundRequestView[] | null
  onOpen: (request: RefundRequestView) => void
  /** Set when loading failed; shown while there is nothing to display. */
  onRetry: (() => void) | null
}

export function RequestHistory({ requests, onOpen, onRetry }: RequestHistoryProps) {
  return (
    <Panel id="history-heading" icon={IconHistory} title="My requests">
      {requests === null ? (
        onRetry ? <LoadError onRetry={onRetry}>We couldn't load your requests.</LoadError> : <PanelMessage>Loading…</PanelMessage>
      ) : requests.length === 0 ? (
        <PanelMessage>No refund requests yet.</PanelMessage>
      ) : (
        <ul className="divide-y divide-slate-100">
          {requests.map((r) => (
            <li key={r.requestId}>
              <button type="button" onClick={() => onOpen(r)} className={`flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-slate-50 ${focusRing}`}>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-slate-500">{r.requestId}</span>
                    <StatusBadge status={r.status} />
                  </span>
                  <span className="mt-1 block text-sm">{r.lines.map((l) => l.itemName).join(', ')}</span>
                  <span className="block text-xs text-slate-500">
                    {r.orderNumber} · {formatDate(r.createdAt)}
                    {r.approvedAmountMinor > 0 && ` · ${formatMoney(r.approvedAmountMinor)} refunded`}
                  </span>
                </span>
                <IconChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
