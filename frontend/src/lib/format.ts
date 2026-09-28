import type { OrderItem } from '../api/client'

export function formatMoney(amountMinor: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountMinor / 100)
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

// Codes whose generated wording would be unclear.
const CODE_LABELS: Record<string, string> = { DEFAULT: 'No rule matched', PARTIALLY_APPROVED: 'Partly approved' }

/** Turns a code such as NO_AI_ASSESSMENT into "No AI assessment". */
export function formatCode(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code]
  const words = code.toLowerCase().split('_').map((w) => (['ai', 'id', 'sku'].includes(w) ? w.toUpperCase() : w))
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Whether an item can still be claimed, with the text colour to show it in. */
export function itemAvailability(item: OrderItem): { text: string; className: string } {
  if (item.refundableQuantity > 0) return { text: `${item.refundableQuantity} of ${item.quantity} eligible to claim`, className: 'text-slate-500' }
  if (item.pendingQuantity > 0) return { text: 'Request in progress', className: 'text-amber-700' }
  return { text: 'Already refunded', className: 'text-emerald-700' }
}
