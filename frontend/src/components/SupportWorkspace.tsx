import { IconAlertTriangle, IconForms, IconHistory, IconLogout, IconMessages, IconPackage, IconPlus, IconX, type Icon } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { api, type Order, type OrderItem, type QuickReply, type RefundRequestView } from '../api/client'
import { storeId, useSupportChat } from '../hooks/useSupportChat'
import { ChatComposer } from './ChatComposer'
import { ChatThread } from './ChatThread'
import { ClaimCard } from './ClaimCard'
import { DecisionCard } from './DecisionCard'
import { OrderDetailsSheet } from './OrderDetailsSheet'
import { OrdersPanel } from './OrdersPanel'
import { RequestHistory } from './RequestHistory'
import { Button, focusRing } from './ui'

type Tab = 'chat' | 'orders' | 'requests'

const TABS: { id: Tab; label: string; icon: Icon }[] = [
  { id: 'chat', label: 'Chat', icon: IconMessages },
  { id: 'orders', label: 'Orders', icon: IconPackage },
  { id: 'requests', label: 'Requests', icon: IconHistory },
]

interface SupportWorkspaceProps {
  firstName: string
  onSignedOut: () => void
}

export function SupportWorkspace({ firstName, onSignedOut }: SupportWorkspaceProps) {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [requests, setRequests] = useState<RefundRequestView[] | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  // Phones show one section at a time; from `lg` all are visible side by side.
  const [tab, setTab] = useState<Tab>('chat')
  const [openOrder, setOpenOrder] = useState<string | null>(null)

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

  const askAbout =
    aiChat && !busy
      ? (item: OrderItem) => {
          setOpenOrder(null)
          setTab('chat')
          chat.send({ orderItemId: item.id }, item.name)
        }
      : null
  const detailsOrder = orders?.find((o) => o.orderNumber === openOrder)
  const inProgress = requests?.filter((r) => r.status === 'PROCESSING' || r.status === 'ESCALATED').length ?? 0

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
    <div className="mx-auto flex max-w-6xl flex-col gap-3 p-3 sm:p-4 lg:grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[20rem_1fr] lg:gap-4">
      <div role="tablist" aria-label="Sections" className="flex rounded-xl bg-slate-200/70 p-1 lg:hidden">
        {TABS.map(({ id, label, icon: TabIcon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-controls={`section-${id}`}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm ${focusRing} ${tab === id ? 'bg-white font-medium shadow-sm' : 'text-slate-600'}`}
          >
            <TabIcon size={16} aria-hidden="true" /> {label}
            {id === 'requests' && inProgress > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{inProgress}</span>}
          </button>
        ))}
      </div>

      <aside className={`space-y-4 lg:order-1 lg:block lg:overflow-y-auto ${tab === 'chat' ? 'hidden' : ''}`}>
        <div id="section-orders" className={tab === 'orders' ? '' : 'hidden lg:block'}>
          <OrdersPanel orders={orders} onAskAbout={askAbout} onOpen={(order) => setOpenOrder(order.orderNumber)} />
        </div>
        <div id="section-requests" className={tab === 'requests' ? '' : 'hidden lg:block'}>
          <RequestHistory requests={requests} />
        </div>
      </aside>

      <section
        id="section-chat"
        aria-label="Support chat"
        className={`h-[calc(100dvh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 sm:h-[calc(100dvh-9.5rem)] lg:order-2 lg:flex lg:h-auto ${tab === 'chat' ? 'flex' : 'hidden'}`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
          <p className="min-w-0 truncate text-sm">
            Hi <span className="font-medium">{firstName}</span>, how can we help?
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {aiChat && !chat.request && !manualOpen && (
              <Button variant="ghost" icon={IconForms} onClick={() => setManualOpen(true)} aria-label="Fill in the details myself" title="Fill in the details myself">
                <span className="hidden sm:inline">Fill in the details myself</span>
              </Button>
            )}
            <Button variant="ghost" icon={IconPlus} onClick={startNew} aria-label="New request" title="New request">
              <span className="hidden sm:inline">New request</span>
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

      {detailsOrder && <OrderDetailsSheet order={detailsOrder} requests={requests} onAskAbout={askAbout} onClose={() => setOpenOrder(null)} />}
    </div>
  )
}
