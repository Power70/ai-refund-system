import { IconSearch, IconTag } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { adminApi, ApiError, type CustomerDetail, type CustomerRow } from '../../api/client'
import { errorMessage } from '../../hooks/useSupportChat'
import { useDebouncedValue, usePolledData } from '../../hooks/usePolledData'
import { formatCode, formatDate, formatMoney, plural } from '../../lib/format'
import { StatusBadge } from '../StatusBadge'
import { Alert, focusRing, inputClass, Pager, Sheet } from '../ui'
import { PAGE_SIZE, REFRESH_MS } from './RequestsView'

const COLUMNS = 'md:grid md:grid-cols-[minmax(0,1.4fr)_5rem_6rem_7rem_7rem] md:items-center md:gap-4'

/** Searchable, paged list of customers; each opens their details. Read-only. */
export function CustomersView({ onUnauthorized }: { onUnauthorized: () => void }) {
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

  const list = usePolledData(() => adminApi.customers({ q: q || undefined, page, pageSize: PAGE_SIZE }), `${q}|${page}`, REFRESH_MS)
  const unauthorized = list.error instanceof ApiError && list.error.status === 401
  useEffect(() => {
    if (unauthorized) onUnauthorized()
  }, [unauthorized, onUnauthorized])

  const rows = list.data?.items ?? []
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE))

  return (
    <section aria-label="Customers" className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 p-3">
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search customers</span>
          <IconSearch size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or email" className={`w-full pl-9 text-sm ${inputClass}`} />
        </label>
      </div>

      <div aria-busy={list.loading} className="min-h-48 text-sm">
        {list.error && !list.data && !unauthorized ? (
          <p role="alert" className="px-4 py-6 text-rose-700">
            Couldn't load customers. Retrying automatically.
          </p>
        ) : !list.data ? (
          <p className="px-4 py-12 text-center text-slate-500">Loading customers…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-slate-500">No customers match.</p>
        ) : (
          <div key={`${q}|${page}`} className={`transition-opacity duration-200 ${list.loading ? 'opacity-50' : 'animate-fade-in motion-reduce:animate-none'}`}>
            <div aria-hidden="true" className={`hidden px-4 py-2 text-xs font-medium text-slate-500 uppercase ${COLUMNS}`}>
              <span>Customer</span>
              <span>Orders</span>
              <span>Requests</span>
              <span>Open</span>
              <span>Refunded</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {rows.map((row) => (
                <li key={row.customerId}>
                  <CustomerRowButton row={row} onOpen={() => setOpenId(row.customerId)} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {rows.length > 0 && <Pager page={page} pages={pages} onPage={setPage} />}
      {openId && <CustomerSheet customerId={openId} onClose={() => setOpenId(null)} />}
    </section>
  )
}

function CustomerRowButton({ row, onOpen }: { row: CustomerRow; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${focusRing} ${COLUMNS}`}>
      <span className="block min-w-0">
        <span className="block truncate font-medium">{row.name}</span>
        <span className="block truncate text-xs text-slate-500">{row.email}</span>
      </span>
      {/* Phones: one line of labelled counts. From md: the bare numbers under column headings. */}
      <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-600 md:hidden">
        <span>{plural(row.orders, 'order')}</span>
        <span>{plural(row.requests, 'request')}</span>
        <span className={row.openRequests > 0 ? 'font-medium text-amber-700' : ''}>{row.openRequests} open</span>
        <span>{formatMoney(row.refundedMinor)} refunded</span>
      </span>
      <span className="hidden tabular-nums md:block">{row.orders}</span>
      <span className="hidden tabular-nums md:block">{row.requests}</span>
      <span className={`hidden tabular-nums md:block ${row.openRequests > 0 ? 'font-medium text-amber-700' : ''}`}>{row.openRequests}</span>
      <span className="hidden tabular-nums md:block">{formatMoney(row.refundedMinor)}</span>
    </button>
  )
}

/** One customer: totals, every order with its items, and every refund request. */
function CustomerSheet({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    adminApi.customer(customerId).then(
      (d) => current && setDetail(d),
      (e: unknown) => current && setError(errorMessage(e)),
    )
    return () => {
      current = false
    }
  }, [customerId])

  const section = 'rounded-2xl border border-slate-200 bg-white'
  const heading = 'border-b border-slate-100 px-4 py-3 text-sm font-semibold'

  return (
    <Sheet
      labelledBy="customer-heading"
      onClose={onClose}
      title={
        <>
          <h2 id="customer-heading" className="truncate font-semibold">
            {detail?.customer.name ?? 'Customer'}
          </h2>
          <p className="truncate text-xs text-slate-500">{detail?.customer.email ?? ' '}</p>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      {!detail && !error && <div className="h-40 animate-pulse rounded-2xl bg-white motion-reduce:animate-none" aria-label="Loading customer" />}
      {detail && (
        <div className="animate-fade-in space-y-4 motion-reduce:animate-none">
          <dl className={`grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm sm:grid-cols-4 ${section}`}>
            <Fact label="Customer since" value={formatDate(detail.customer.createdAt)} />
            <Fact label="Orders" value={String(detail.orders.length)} />
            <Fact label="Ordered" value={formatMoney(detail.totals.orderedMinor)} />
            <Fact label="Refunded" value={formatMoney(detail.totals.refundedMinor)} />
          </dl>

          <section aria-labelledby="customer-orders" className={section}>
            <h3 id="customer-orders" className={heading}>
              Orders
            </h3>
            <ul className="divide-y divide-slate-100">
              {detail.orders.map((order) => (
                <li key={order.orderNumber} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-sm font-medium">{order.orderNumber}</span>
                    <span className="text-xs text-slate-500">
                      Placed {formatDate(order.placedAt)} · {order.deliveredAt ? `delivered ${formatDate(order.deliveredAt)}` : 'not delivered yet'}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {order.items.map((item) => (
                      <li key={item.sku} className="flex items-start justify-between gap-3 text-sm">
                        <span className="min-w-0">
                          {item.quantity} × {item.name}
                          {item.finalSale && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                              <IconTag size={11} aria-hidden="true" /> Final sale
                            </span>
                          )}
                          {(item.refundedQuantity > 0 || item.pendingQuantity > 0) && (
                            <span className="block text-xs text-slate-500">
                              {[item.refundedQuantity > 0 && `${item.refundedQuantity} refunded`, item.pendingQuantity > 0 && `${item.pendingQuantity} in a request`].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 tabular-nums">{formatMoney(item.quantity * item.unitPricePaidMinor, order.currency)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="flex justify-between border-t border-slate-100 pt-2 text-xs text-slate-600">
                    <span>Total {formatMoney(order.totalMinor, order.currency)}</span>
                    <span>Refunded {formatMoney(order.refundedMinor, order.currency)}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="customer-requests" className={section}>
            <h3 id="customer-requests" className={heading}>
              Refund requests
            </h3>
            {detail.requests.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-500">No refund requests.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {detail.requests.map((r) => (
                  <li key={r.requestId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="block font-mono text-xs text-indigo-700">{r.requestId}</span>
                      <span className="block text-xs text-slate-500">
                        {formatDate(r.createdAt)} · {r.orderNumber} · {formatCode(r.reason)}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <StatusBadge status={r.status} />
                      <span className="text-xs text-slate-500">
                        {r.resolution && `Resolved: ${formatCode(r.resolution)} · `}
                        {formatMoney(r.approvedAmountMinor)} of {formatMoney(r.requestedAmountMinor)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
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
