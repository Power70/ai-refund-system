import { IconClipboardCheck, IconInfoCircle, IconMinus, IconPlus, IconX } from '@tabler/icons-react'
import { useRef, useState } from 'react'
import type { Conversation, Order, Proposal, RefundReason } from '../api/client'
import { formatMoney } from '../lib/format'
import { Button, ChatCard, inputClass, pillClass } from './ui'

export interface ClaimDraft {
  orderNumber: string
  reason: RefundReason
  lines: { itemId: string; quantity: number }[]
}

interface ClaimCardProps {
  orders: Order[]
  reasons: Conversation['reasons']
  /** The AI's proposal to confirm, or null for a claim filled in by hand. */
  proposal: Proposal | null
  submitting: boolean
  onSubmit: (claim: ClaimDraft, idempotencyKey: string) => void
  onCancel?: () => void
}

const claimableOrders = (orders: Order[]) => orders.filter((o) => o.items.some((i) => i.refundableQuantity > 0))

export function ClaimCard({ orders, reasons, proposal, submitting, onSubmit, onCancel }: ClaimCardProps) {
  const lastSubmission = useRef<{ payload: string; key: string } | null>(null)
  const [orderNumber, setOrderNumber] = useState(proposal?.orderNumber ?? claimableOrders(orders)[0]?.orderNumber ?? '')
  const [reason, setReason] = useState<RefundReason | null>(proposal?.reason ?? null)
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries((proposal?.lines ?? []).map((l) => [l.orderItemId, l.quantity])))

  const order = orders.find((o) => o.orderNumber === orderNumber)
  const items = order?.items.filter((i) => i.refundableQuantity > 0 || quantities[i.id]) ?? []
  const lines = items.filter((i) => (quantities[i.id] ?? 0) > 0).map((i) => ({ itemId: i.id, quantity: quantities[i.id] }))
  const total = items.reduce((sum, i) => sum + i.unitPricePaidMinor * (quantities[i.id] ?? 0), 0)
  const proposedIds = new Set(proposal?.lines.map((l) => l.orderItemId))
  const needsReview = proposal !== null && (reason !== proposal.reason || lines.some((l) => !proposedIds.has(l.itemId)))
  const canSubmit = !submitting && reason !== null && lines.length > 0

  const submit = () => {
    if (!canSubmit || !reason) return
    const claim: ClaimDraft = { orderNumber, reason, lines }
    const payload = JSON.stringify(claim)
    // Reuse the key only when retrying the identical claim; any edit is a new submission.
    if (lastSubmission.current?.payload !== payload) lastSubmission.current = { payload, key: crypto.randomUUID() }
    onSubmit(claim, lastSubmission.current.key)
  }

  return (
    <ChatCard labelledBy="claim-heading" className="border-indigo-200">
      <div className="flex items-start justify-between gap-2">
        <h3 id="claim-heading" className="flex items-center gap-2 font-semibold">
          <IconClipboardCheck size={20} className="text-indigo-600" aria-hidden="true" />
          {proposal ? 'Please check your request' : 'Your refund request'}
        </h3>
        {onCancel && <Button variant="icon" icon={IconX} onClick={onCancel} aria-label="Close form" />}
      </div>

      {proposal ? (
        <p className="mt-1 text-sm text-slate-600">
          Order <span className="font-mono">{orderNumber}</span>. Adjust anything that isn't right, then submit.
        </p>
      ) : (
        <label className="mt-3 block text-sm">
          <span className="font-medium text-slate-700">Order</span>
          <select
            value={orderNumber}
            onChange={(e) => {
              setOrderNumber(e.target.value)
              setQuantities({})
            }}
            className={`mt-1 w-full ${inputClass}`}
          >
            {claimableOrders(orders).map((o) => (
              <option key={o.orderNumber} value={o.orderNumber}>
                {o.orderNumber} ({o.items.map((i) => i.name).join(', ')})
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-slate-700">Items</legend>
        <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {items.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Nothing left to claim on this order.</li>}
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm">{item.name}</p>
                <p className="text-xs text-slate-500">
                  {formatMoney(item.unitPricePaidMinor, order?.currency)} each · up to {item.refundableQuantity}
                </p>
              </div>
              <QuantityStepper
                label={item.name}
                value={quantities[item.id] ?? 0}
                max={item.refundableQuantity}
                onChange={(quantity) => setQuantities((q) => ({ ...q, [item.id]: quantity }))}
              />
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-slate-700">Reason</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {reasons.map((option) => (
            <label
              key={option.reason}
              className={`cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-indigo-300 ${pillClass} ${
                reason === option.reason ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-indigo-300'
              }`}
            >
              <input type="radio" name="claim-reason" value={option.reason} checked={reason === option.reason} onChange={() => setReason(option.reason)} className="sr-only" />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      {needsReview && (
        <p className="mt-3 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <IconInfoCircle size={18} className="shrink-0" aria-hidden="true" />
          Changes like this are checked by our support team before a decision is made.
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <p className="text-sm text-slate-600">
          Items total: <span className="font-medium text-slate-900">{formatMoney(total, order?.currency)}</span>
        </p>
        <Button onClick={submit} disabled={!canSubmit} busy={submitting}>
          {submitting ? 'Submitting…' : 'Submit request'}
        </Button>
      </div>
    </ChatCard>
  )
}

function QuantityStepper({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  const step = (delta: number, disabled: boolean, name: string, icon: typeof IconPlus) => (
    <Button variant="icon" icon={icon} onClick={() => onChange(value + delta)} disabled={disabled} aria-label={`${name} ${label}`} className="size-8 border border-slate-300" />
  )
  return (
    <div className="flex items-center gap-1" role="group" aria-label={`Quantity of ${label}`}>
      {step(-1, value === 0, 'Fewer', IconMinus)}
      <output className="w-6 text-center text-sm tabular-nums" aria-live="polite">
        {value}
      </output>
      {step(1, value >= max, 'More', IconPlus)}
    </div>
  )
}
