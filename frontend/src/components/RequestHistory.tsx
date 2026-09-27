import { IconHistory } from '@tabler/icons-react'
import type { RefundRequestView } from '../api/client'
import { formatDate, formatMoney } from '../lib/format'
import { StatusBadge } from './StatusBadge'
import { Panel, PanelMessage } from './ui'

export function RequestHistory({ requests }: { requests: RefundRequestView[] | null }) {
  return (
    <Panel id="history-heading" icon={IconHistory} title="My requests">
      {requests === null ? (
        <PanelMessage>Loading…</PanelMessage>
      ) : requests.length === 0 ? (
        <PanelMessage>No refund requests yet.</PanelMessage>
      ) : (
        <ul className="divide-y divide-slate-100">
          {requests.map((r) => (
            <li key={r.requestId} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-slate-500">{r.requestId}</span>
                <StatusBadge status={r.status} />
              </div>
              <p className="mt-1 text-sm">{r.lines.map((l) => l.itemName).join(', ')}</p>
              <p className="text-xs text-slate-500">
                {r.orderNumber} · {formatDate(r.createdAt)}
                {r.approvedAmountMinor > 0 && ` · ${formatMoney(r.approvedAmountMinor)} refunded`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
