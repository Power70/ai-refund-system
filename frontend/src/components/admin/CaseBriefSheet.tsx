import { IconAlertTriangle, IconCheck, IconFlag, IconGavel, IconSparkles, IconX } from '@tabler/icons-react'
import { useEffect, useState, type ReactNode } from 'react'
import { ApiError, type AdminApi, type CaseBrief } from '../../api/client'
import { errorMessage } from '../../hooks/useSupportChat'
import { formatCode, formatDate, formatMoney, formatTime } from '../../lib/format'
import { StatusBadge } from '../StatusBadge'
import { Alert, Button, inputClass, pillClass, Sheet, Spinner } from '../ui'

interface CaseBriefSheetProps {
  api: AdminApi
  requestId: string
  onClose: () => void
  onResolved: () => void
}

/** Side sheet with everything a reviewer needs; customer text is rendered as plain text. */
export function CaseBriefSheet({ api, requestId, onClose, onResolved }: CaseBriefSheetProps) {
  const [brief, setBrief] = useState<CaseBrief | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    api.caseBrief(requestId).then(
      (b) => current && setBrief(b),
      (e: unknown) => current && setError(errorMessage(e)),
    )
    return () => {
      current = false
    }
  }, [api, requestId])

  const canResolve = brief?.decision?.status === 'ESCALATED' && !brief.resolution

  return (
    <Sheet
      labelledBy="brief-heading"
      onClose={onClose}
      title={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 id="brief-heading" className="truncate font-mono text-sm font-semibold">
            {requestId}
          </h2>
          {brief?.decision && <StatusBadge status={brief.decision.status} />}
          {brief?.resolution && <span className="text-xs text-slate-500">Resolved: {formatCode(brief.resolution.outcome)}</span>}
        </div>
      }
    >
          {error && <Alert>{error}</Alert>}
          {!brief && !error && (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner /> Loading case…
            </p>
          )}
          {brief && (
            <>
              <Overview brief={brief} />
              <AiSuggestion brief={brief} />
              <ClaimComparison brief={brief} />
              <Items brief={brief} />
              {canResolve && (
                <ResolveForm
                  brief={brief}
                  onResolve={async (decisions, note) => {
                    const updated = await api.resolve(requestId, decisions, note)
                    setBrief(updated)
                    onResolved()
                  }}
                />
              )}
              {brief.resolution && (
                <Section title="Resolution" icon={<IconGavel size={16} aria-hidden="true" />}>
                  <p className="text-sm">
                    {formatCode(brief.resolution.outcome)} · {formatMoney(brief.resolution.approvedAmountMinor, brief.order.currency)} ·{' '}
                    {formatDate(brief.resolution.resolvedAt)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">Note: {brief.resolution.reviewerNote}</p>
                </Section>
              )}
              {brief.decision && (
                <Section title={`Message shown to the customer (${brief.resolution ? 'after review' : brief.decision.messageSource === 'AI' ? 'AI, checked' : 'template'})`}>
                  <p className="text-sm whitespace-pre-wrap">{brief.resolution?.customerMessage ?? brief.decision.customerMessage}</p>
                </Section>
              )}
              <Transcript brief={brief} />
              <TechnicalDetails brief={brief} />
            </>
          )}
    </Sheet>
  )
}

function Section({ title, icon, children, tone = 'border-slate-200 bg-white' }: { title: string; icon?: ReactNode; children: ReactNode; tone?: string }) {
  return (
    <section className={`rounded-xl border p-3 ${tone}`}>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

function Overview({ brief }: { brief: CaseBrief }) {
  const facts: [string, ReactNode][] = [
    ['Customer', `${brief.customer.name} (${brief.customer.email})`],
    ['Order', `${brief.order.orderNumber} · ${brief.order.deliveredAt ? `delivered ${formatDate(brief.order.deliveredAt)}` : 'not delivered'}`],
    ['Submitted', `${formatDate(brief.request.createdAt)} ${formatTime(brief.request.createdAt)}${brief.request.source === 'SEED' ? ' (demo history)' : ''}`],
    ['Policy', brief.decision?.policyVersion ?? '—'],
  ]
  const flags = brief.conversation
    ? [
        ...Object.entries(brief.conversation.flags).filter(([, on]) => on).map(([name]) => formatCode(name.replace(/([A-Z])/g, '_$1'))),
        ...(brief.conversation.priorFlaggedConversation ? ['Flagged chat in the last 30 days'] : []),
      ]
    : []
  return (
    <Section title="Overview">
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[7rem_1fr]">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {brief.decision && brief.decision.escalationReasons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {brief.decision.escalationReasons.map((r) => (
            <span key={r} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
              {formatCode(r)}
            </span>
          ))}
        </div>
      )}
      {flags.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-rose-700">
          <IconFlag size={14} aria-hidden="true" /> {flags.join(' · ')}
        </p>
      )}
    </Section>
  )
}

function AiSuggestion({ brief }: { brief: CaseBrief }) {
  if (brief.aiSummarySuppressed) {
    return (
      <Section title="AI suggestion" icon={<IconSparkles size={16} aria-hidden="true" />} tone="border-rose-200 bg-rose-50">
        <p className="flex gap-2 text-sm text-rose-800">
          <IconAlertTriangle size={18} className="shrink-0" aria-hidden="true" />
          Withheld: the customer may have tried to instruct the assistant. Read the transcript directly.
        </p>
      </Section>
    )
  }
  if (!brief.aiSummary) return null
  return (
    <Section title="AI suggestion (advisory)" icon={<IconSparkles size={16} aria-hidden="true" />} tone="border-indigo-200 bg-indigo-50/50">
      <p className="text-sm">{brief.aiSummary.summary}</p>
      <p className="mt-2 text-sm">
        <span className="font-medium">Suggests: {formatCode(brief.aiSummary.suggestedAction)}.</span> {brief.aiSummary.rationale}
      </p>
    </Section>
  )
}

function ClaimComparison({ brief }: { brief: CaseBrief }) {
  const { proposed, confirmed, reasonOverridden, itemsNotDiscussed } = brief.claim
  const describe = (lines: { itemName: string; quantity: number }[]) => lines.map((l) => `${l.quantity} × ${l.itemName}`).join(', ')
  const changed = 'bg-amber-100 text-amber-900 rounded px-1'
  return (
    <Section title="AI proposal vs confirmed claim">
      {proposed ? (
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="w-24 py-1 text-left font-medium" />
              <th className="py-1 text-left font-medium">AI proposed ({Math.round(proposed.confidence * 100)}% confident)</th>
              <th className="py-1 text-left font-medium">Customer confirmed</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-1 text-slate-500">Reason</td>
              <td className="py-1">{formatCode(proposed.reason)}</td>
              <td className="py-1">
                <span className={reasonOverridden ? changed : undefined}>{formatCode(confirmed.reason)}</span>
              </td>
            </tr>
            <tr>
              <td className="py-1 align-top text-slate-500">Items</td>
              <td className="py-1 align-top">{describe(proposed.lines)}</td>
              <td className="py-1 align-top">{describe(confirmed.lines)}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-slate-600">
          No AI proposal. Customer filled in: {formatCode(confirmed.reason)}, {describe(confirmed.lines)}.
        </p>
      )}
      {itemsNotDiscussed.length > 0 && <p className={`mt-2 inline-block text-sm ${changed}`}>Not discussed in chat: {itemsNotDiscussed.join(', ')}</p>}
    </Section>
  )
}

function Items({ brief }: { brief: CaseBrief }) {
  return (
    <Section title="Items and policy outcome">
      <ul className="divide-y divide-slate-100 text-sm">
        {brief.lines.map((line) => (
          <li key={line.lineId} className="py-2">
            <div className="flex justify-between gap-2">
              <span>
                {line.quantity} × {line.itemName}
                {line.finalSale && <span className="ml-1 rounded bg-slate-100 px-1 text-[11px]">final sale</span>}
              </span>
              <span className="tabular-nums">{formatMoney(line.amountMinor, brief.order.currency)}</span>
            </div>
            <p className="text-xs text-slate-500">
              Policy: {line.lineOutcome ?? '—'}
              {line.decidingRuleId ? ` (${line.decidingRuleId})` : line.lineOutcome ? ' (default)' : ''} · Status: {line.finalLineStatus ? formatCode(line.finalLineStatus) : '—'}
            </p>
            {line.publicReason && <p className="text-xs text-slate-500">“{line.publicReason}”</p>}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function ResolveForm({ brief, onResolve }: { brief: CaseBrief; onResolve: (decisions: { lineId: string; approve: boolean }[], note: string) => Promise<void> }) {
  const [approve, setApprove] = useState<Record<string, boolean>>({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const decided = brief.lines.every((l) => approve[l.lineId] !== undefined)
  const total = brief.lines.filter((l) => approve[l.lineId]).reduce((sum, l) => sum + l.amountMinor, 0)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onResolve(
        brief.lines.map((l) => ({ lineId: l.lineId, approve: approve[l.lineId] })),
        note.trim(),
      )
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'ALREADY_RESOLVED' ? 'Another reviewer resolved this case. Close and reopen it to see their decision.' : errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Section title="Resolve" icon={<IconGavel size={16} aria-hidden="true" />} tone="border-amber-200 bg-amber-50/50">
      <ul className="space-y-2">
        {brief.lines.map((line) => (
          <li key={line.lineId} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {line.quantity} × {line.itemName} <span className="text-slate-500">({formatMoney(line.amountMinor, brief.order.currency)})</span>
            </span>
            <span role="radiogroup" aria-label={`Decision for ${line.itemName}`} className="flex gap-1">
              {[true, false].map((value) => {
                const selected = approve[line.lineId] === value
                const tone = value ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-rose-600 bg-rose-600 text-white'
                const Icon = value ? IconCheck : IconX
                return (
                  <button
                    key={String(value)}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setApprove((a) => ({ ...a, [line.lineId]: value }))}
                    className={`inline-flex items-center gap-1 ${pillClass} ${selected ? tone : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    <Icon size={14} aria-hidden="true" /> {value ? 'Refund' : 'Reject'}
                  </button>
                )
              })}
            </span>
          </li>
        ))}
      </ul>
      <label className="mt-3 block text-sm">
        <span className="font-medium text-slate-700">Internal note (not shown to the customer)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className={`mt-1 w-full ${inputClass}`} />
      </label>
      {error && (
        <div className="mt-2">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-sm text-slate-600">Refund total: {formatMoney(total, brief.order.currency)}</span>
        <Button onClick={() => void submit()} busy={busy} disabled={busy || !decided || note.trim().length < 3}>
          Save decision
        </Button>
      </div>
    </Section>
  )
}

function Transcript({ brief }: { brief: CaseBrief }) {
  if (!brief.conversation) return null
  const { transcript, evidenceQuotes, mode, handoverReason } = brief.conversation
  return (
    <Section title={`Conversation (${mode === 'AI' ? 'AI chat' : `claim form${handoverReason ? `, ${formatCode(handoverReason).toLowerCase()}` : ''}`})`}>
      <ol className="space-y-2">
        {transcript.map((m, i) => (
          <li key={i} className={`rounded-lg px-3 py-2 text-sm ${m.role === 'CUSTOMER' ? 'bg-indigo-50' : 'bg-slate-100'}`}>
            <span className="mr-2 text-xs font-medium text-slate-500">
              {m.role === 'CUSTOMER' ? (m.typed ? 'Customer' : 'Customer (tapped)') : 'Assistant'} · {formatTime(m.at)}
            </span>
            <span className="whitespace-pre-wrap">{m.role === 'CUSTOMER' ? highlight(m.text, evidenceQuotes) : m.text}</span>
          </li>
        ))}
      </ol>
      {evidenceQuotes.length > 0 && <p className="mt-2 text-xs text-slate-500">Highlighted: quotes the AI cited as evidence.</p>}
    </Section>
  )
}

/** Marks each quote (case-insensitive) inside the text. */
function highlight(text: string, quotes: string[]): ReactNode {
  const ranges = quotes
    .map((q) => {
      const start = text.toLowerCase().indexOf(q.toLowerCase())
      return start < 0 ? null : [start, start + q.length]
    })
    .filter((r): r is number[] => r !== null)
    .sort((a, b) => a[0] - b[0])
  const parts: ReactNode[] = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start < cursor) continue
    parts.push(text.slice(cursor, start), <mark key={start} className="rounded bg-yellow-200 px-0.5">{text.slice(start, end)}</mark>)
    cursor = end
  }
  parts.push(text.slice(cursor))
  return parts
}

function TechnicalDetails({ brief }: { brief: CaseBrief }) {
  return (
    <Section title="Technical details">
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-700">AI calls ({brief.aiCalls.length})</summary>
        <table className="mt-2 w-full text-xs">
          <tbody className="divide-y divide-slate-100">
            {brief.aiCalls.map((c, i) => (
              <tr key={i}>
                <td className="py-1">{formatCode(c.kind)}</td>
                <td className="py-1">{c.outcome}</td>
                <td className="py-1">{c.provider ?? '—'} {c.model ?? ''}</td>
                <td className="py-1 tabular-nums">{c.latencyMs} ms</td>
                <td className="py-1 tabular-nums">{c.inputTokens ?? '–'}/{c.outputTokens ?? '–'} tokens</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-slate-700">Safety gate and rule trace</summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">{JSON.stringify({ gate: brief.decision?.gateResult, trace: brief.decision?.ruleTrace }, null, 2)}</pre>
      </details>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-slate-700">Audit trail ({brief.audit.length})</summary>
        <ol className="mt-2 space-y-1 text-xs">
          {brief.audit.map((a, i) => (
            <li key={i}>
              <span className="text-slate-500">{formatTime(a.at)}</span> {formatCode(a.type)} <span className="text-slate-500">by {a.actor.toLowerCase()}</span>
            </li>
          ))}
        </ol>
      </details>
    </Section>
  )
}
