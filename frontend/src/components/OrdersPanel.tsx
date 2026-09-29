import { IconChevronRight, IconMessageCircleQuestion, IconPackage, IconTag } from '@tabler/icons-react'
import type { Order, OrderItem } from '../api/client'
import { formatDate, formatMoney } from '../lib/format'
import { Button, focusRing, LoadError, Panel, PanelMessage } from './ui'

interface OrdersPanelProps {
  orders: Order[] | null
  /** Null when items can't be discussed right now (e.g. the claim was already submitted). */
  onAskAbout: ((item: OrderItem) => void) | null
  onOpen: (order: Order) => void
  /** Set when loading failed; shown while there is nothing to display. */
  onRetry: (() => void) | null
}

export function OrdersPanel({ orders, onAskAbout, onOpen, onRetry }: OrdersPanelProps) {
  return (
    <Panel id="orders-heading" icon={IconPackage} title="Your orders">
      {orders === null ? (
        onRetry ? <LoadError onRetry={onRetry}>We couldn't load your orders.</LoadError> : <PanelMessage>Loading orders…</PanelMessage>
      ) : (
        <ul className="divide-y divide-slate-100">
          {orders.map((order) => (
            <li key={order.orderNumber} className="px-4 py-3">
              <button
                type="button"
                onClick={() => onOpen(order)}
                className={`-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-slate-50 ${focusRing}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-sm font-medium">{order.orderNumber}</span>
                  <span className="block text-xs text-slate-500">{order.deliveredAt ? `Delivered ${formatDate(order.deliveredAt)}` : 'On its way'}</span>
                </span>
                <span className="inline-flex shrink-0 items-center text-xs font-medium text-indigo-700">
                  Details <IconChevronRight size={14} aria-hidden="true" />
                </span>
              </button>
              <ul className="mt-2 space-y-2">
                {order.items.map((item) => (
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
                        <p className="text-xs text-slate-500">
                          {formatMoney(item.unitPricePaidMinor, order.currency)}
                        </p>
                      </div>
                      {onAskAbout && item.refundableQuantity > 0 && (
                        <Button variant="icon" icon={IconMessageCircleQuestion} onClick={() => onAskAbout(item)} aria-label={`Ask about ${item.name}`} className="shrink-0 text-indigo-600!" />
                      )}
                    </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
