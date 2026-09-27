import { IconCircleCheck, IconCircleX, IconClockHour4 } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import type { RequestStatus } from '../api/client'
import { Spinner } from './ui'

const STYLES: Record<RequestStatus, { label: string; className: string; icon: ReactNode }> = {
  APPROVED: { label: 'Approved', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: <IconCircleCheck size={14} aria-hidden="true" /> },
  DENIED: { label: 'Not approved', className: 'bg-rose-50 text-rose-700 ring-rose-200', icon: <IconCircleX size={14} aria-hidden="true" /> },
  ESCALATED: { label: 'In review', className: 'bg-amber-50 text-amber-800 ring-amber-200', icon: <IconClockHour4 size={14} aria-hidden="true" /> },
  PROCESSING: { label: 'Processing', className: 'bg-slate-100 text-slate-700 ring-slate-200', icon: <Spinner size={14} /> },
}

export function StatusBadge({ status, label }: { status: RequestStatus; label?: string }) {
  const style = STYLES[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${style.className}`}>
      {style.icon}
      {label ?? style.label}
    </span>
  )
}
