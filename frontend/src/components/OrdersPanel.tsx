import { IconMessageCircleQuestion, IconPackage, IconTag } from '@tabler/icons-react'
import type { Order, OrderItem } from '../api/client'
import { formatDate, formatMoney } from '../lib/format'
import { Button, Panel, PanelMessage } from './ui'

interface OrdersPanelProps {
  orders: Order[] | null
  /** Null when items can't be discussed right now (e.g. the claim was already submitted). */
  onAskAbout: ((item: OrderItem) => void) | null
}

function availability(item: OrderItem): { text: string; className: string } {
  if (item.refundableQuantity > 0) return { text: `${item.refundableQuantity} of ${item.quantity} eligible to claim`, className: 'text-slate-500' }
  if (item.pendingQuantity > 0) return { text: 'Request in progress', className: 'text-amber-700' }
  return { text: 'Already refunded', className: 'text-emerald-700' }
}

export function OrdersPanel({ orders, onAskAbout }: OrdersPanelProps) {
  return (
    <Panel id="orders-heading" icon={IconPackage} title="Your orders">
      {orders === null ? (
        <PanelMessage>Loading orders…</PanelMessage>
      ) : (
        <ul className="divide-y divide-slate-100">
          {orders.map((order) => (
            <li key={order.orderNumber} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-medium">{order.orderNumber}</span>
                <span className="text-xs text-slate-500">{order.deliveredAt ? `Delivered ${formatDate(order.deliveredAt)}` : 'Not delivered yet'}</span>
              </div>
              <ul className="mt-2 space-y-2">
                {order.items.map((item) => {
                  const status = availability(item)
                  return (
                    <li key={item.id} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm">
                          {item.name}
                          {item.finalSale && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                              <IconTag size={11} aria-hidden="true" /> Final sale
                            </span>
                          )}
                        </p>
                        <p className={`text-xs ${status.className}`}>
                          {formatMoney(item.unitPricePaidMinor, order.currency)} · {status.text}
                        </p>
                      </div>
                      {onAskAbout && item.refundableQuantity > 0 && (
                        <Button variant="icon" icon={IconMessageCircleQuestion} onClick={() => onAskAbout(item)} aria-label={`Ask about ${item.name}`} className="shrink-0 text-indigo-600!" />
                      )}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
