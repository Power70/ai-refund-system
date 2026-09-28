import { IconMessageCircleQuestion, IconTag } from '@tabler/icons-react'
import type { Order, OrderItem, RefundRequestView } from '../api/client'
import { formatDate, formatMoney, itemAvailability } from '../lib/format'
import { RequestLines } from './DecisionCard'
import { StatusBadge } from './StatusBadge'
import { Button, Sheet } from './ui'

interface OrderDetailsSheetProps {
  order: Order
  /** The customer's requests; those for this order are shown. */
  requests: RefundRequestView[] | null
  /** Null when items can't be discussed right now. */
  onAskAbout: ((item: OrderItem) => void) | null
  onClose: () => void
}

const sectionClass = 'rounded-2xl border border-slate-200 bg-white'
const sectionHeading = 'border-b border-slate-100 px-4 py-3 text-sm font-semibold'

export function OrderDetailsSheet({ order, requests, onAskAbout, onClose }: OrderDetailsSheetProps) {
  const money = (minor: number) => formatMoney(minor, order.currency)
  const total = order.items.reduce((sum, i) => sum + i.quantity * i.unitPricePaidMinor, 0)
  const refunded = order.items.reduce((sum, i) => sum + i.refundedQuantity * i.unitPricePaidMinor, 0)
  const orderRequests = requests?.filter((r) => r.orderNumber === order.orderNumber) ?? []

  return (
    <Sheet
      labelledBy="order-heading"
      onClose={onClose}
      title={
        <>
          <h2 id="order-heading" className="font-semibold">
            Order <span className="font-mono">{order.orderNumber}</span>
          </h2>
          <p className="text-xs text-slate-500">
            {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
          </p>
        </>
      }
    >
      <dl className={`grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm sm:grid-cols-4 ${sectionClass}`}>
        <Fact label="Placed" value={formatDate(order.placedAt)} />
        <Fact label="Delivery" value={order.deliveredAt ? `Delivered ${formatDate(order.deliveredAt)}` : 'On its way'} />
        <Fact label="Order total" value={money(total)} />
        <Fact label="Refunded" value={money(refunded)} />
      </dl>

      <section aria-labelledby="order-items-heading" className={sectionClass}>
        <h3 id="order-items-heading" className={sectionHeading}>
          Items
        </h3>
        <ul className="divide-y divide-slate-100">
          {order.items.map((item) => {
            const status = itemAvailability(item)
            return (
              <li key={item.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {item.name}
                      {item.finalSale && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-600">
                          <IconTag size={11} aria-hidden="true" /> Final sale
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {item.quantity} × {money(item.unitPricePaidMinor)}
                    </p>
                    <p className={`text-xs ${status.className}`}>{status.text}</p>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums">{money(item.quantity * item.unitPricePaidMinor)}</span>
                </div>
                {onAskAbout && item.refundableQuantity > 0 && (
                  <Button variant="ghost" icon={IconMessageCircleQuestion} onClick={() => onAskAbout(item)} className="mt-2 -ml-2.5 text-indigo-700">
                    Ask about this item
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-labelledby="order-requests-heading" className={sectionClass}>
        <h3 id="order-requests-heading" className={sectionHeading}>
          Refund requests
        </h3>
        {orderRequests.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">{requests === null ? 'Loading…' : 'No refund requests for this order.'}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {orderRequests.map((r) => (
              <li key={r.requestId} className="space-y-2 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">
                    {formatDate(r.createdAt)} · <span className="font-mono">{r.requestId}</span>
                  </span>
                  <StatusBadge status={r.status} />
                </div>
                <RequestLines lines={r.lines} />
                {r.customerMessage && <p className="text-sm whitespace-pre-wrap text-slate-700">{r.customerMessage}</p>}
                {r.approvedAmountMinor > 0 && <p className="text-sm font-medium">Refunded {money(r.approvedAmountMinor)}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Sheet>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
