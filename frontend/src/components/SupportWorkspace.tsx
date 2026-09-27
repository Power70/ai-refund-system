import { IconAlertTriangle, IconForms, IconLogout, IconPlus, IconX } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { api, type Order, type QuickReply, type RefundRequestView } from '../api/client'
import { storeId, useSupportChat } from '../hooks/useSupportChat'
import { ChatComposer } from './ChatComposer'
import { ChatThread } from './ChatThread'
import { ClaimCard } from './ClaimCard'
import { DecisionCard } from './DecisionCard'
import { OrdersPanel } from './OrdersPanel'
import { RequestHistory } from './RequestHistory'
import { Button } from './ui'

interface SupportWorkspaceProps {
  firstName: string
  onSignedOut: () => void
}

export function SupportWorkspace({ firstName, onSignedOut }: SupportWorkspaceProps) {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [requests, setRequests] = useState<RefundRequestView[] | null>(null)
  const [manualOpen, setManualOpen] = useState(false)

  const [refreshCount, setRefreshCount] = useState(0)
  useEffect(() => {
    let current = true
    Promise.all([api.orders(), api.refundRequests()])
      .then(([nextOrders, nextRequests]) => {
        if (!current) return
        setOrders(nextOrders)
        setRequests(nextRequests)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [refreshCount])

  const chat = useSupportChat(useCallback(() => setRefreshCount((n) => n + 1), []))
  const conversation = chat.conversation
  const active = conversation?.state === 'ACTIVE'
  const aiChat = active && conversation.mode === 'AI'
  const busy = chat.pending !== null && !chat.pending.failed

  const proposal = aiChat && !manualOpen ? conversation.proposal : null
  const showClaim = active && !chat.request && orders !== null && (conversation.mode === 'MANUAL' || manualOpen || proposal !== null)
  const currency = orders?.find((o) => o.orderNumber === chat.request?.orderNumber)?.currency

  const onQuickReply = (reply: QuickReply) => {
    if (reply.kind === 'ITEM') chat.send({ orderItemId: reply.orderItemId }, reply.label)
    else if (reply.kind === 'REASON') chat.send({ reason: reply.reason }, reply.label)
    else chat.send({ answer: reply.value }, reply.label)
  }

  const startNew = () => {
    setManualOpen(false)
    void chat.startNew()
  }

  const signOut = async () => {
    await api.signOut().catch(() => undefined)
    storeId(null)
    onSignedOut()
  }

  const composer = !conversation
    ? null
    : conversation.state === 'SUBMITTED'
      ? { placeholder: 'Ask a question about this request…' }
      : aiChat
        ? { placeholder: 'Describe what happened…' }
        : null

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-3 sm:p-4 lg:h-[calc(100dvh-4rem)] lg:grid-cols-[20rem_1fr]">
      <aside className="order-2 space-y-4 lg:order-1 lg:overflow-y-auto">
        <OrdersPanel orders={orders} onAskAbout={aiChat && !busy ? (item) => chat.send({ orderItemId: item.id }, item.name) : null} />
        <RequestHistory requests={requests} />
      </aside>

      <section aria-label="Support chat" className="order-1 flex h-[calc(100dvh-5.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 lg:order-2 lg:h-auto">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
          <p className="text-sm">
            Hi <span className="font-medium">{firstName}</span>, how can we help?
          </p>
          <div className="flex items-center gap-1">
            {aiChat && !chat.request && !manualOpen && (
              <Button variant="ghost" icon={IconForms} onClick={() => setManualOpen(true)}>
                Fill in the details myself
              </Button>
            )}
            <Button variant="ghost" icon={IconPlus} onClick={startNew}>
              New request
            </Button>
            <Button variant="icon" icon={IconLogout} onClick={() => void signOut()} aria-label="Sign out" />
          </div>
        </div>

        {conversation ? (
          <ChatThread
            messages={conversation.messages}
            pending={chat.pending}
            quickReplies={conversation.quickReplies}
            onQuickReply={aiChat && !busy ? onQuickReply : null}
            onRetry={chat.error?.retry ?? null}
            contentKey={`${showClaim}-${JSON.stringify(proposal)}-${chat.request?.status ?? ''}`}
            cardsAfter={chat.request ? conversation.messages.filter((m) => m.createdAt <= chat.request!.createdAt).length : conversation.messages.length}
          >
            {showClaim && orders && (
              <ClaimCard
                key={proposal ? JSON.stringify(proposal) : 'manual'}
                orders={orders}
                reasons={conversation.reasons}
                proposal={proposal}
                submitting={chat.submitting}
                onSubmit={(claim, key) => void chat.submit(claim, key)}
                onCancel={manualOpen ? () => setManualOpen(false) : undefined}
              />
            )}
            {chat.request && <DecisionCard request={chat.request} currency={currency} />}
          </ChatThread>
        ) : (
          <p className="flex-1 px-4 py-6 text-sm text-slate-500">Starting a conversation…</p>
        )}

        {chat.error && !chat.pending?.failed && (
          <div role="alert" className="flex items-center gap-2 border-t border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
            <IconAlertTriangle size={18} aria-hidden="true" />
            <span className="flex-1">{chat.error.message}</span>
            {chat.error.retry && (
              <button type="button" onClick={chat.error.retry} className="font-medium underline">
                Try again
              </button>
            )}
            <button type="button" onClick={chat.dismissError} aria-label="Dismiss">
              <IconX size={16} aria-hidden="true" />
            </button>
          </div>
        )}

        {composer && <ChatComposer placeholder={composer.placeholder} disabled={busy || chat.submitting} onSend={(text) => chat.send({ text }, text)} />}
      </section>
    </div>
  )
}
