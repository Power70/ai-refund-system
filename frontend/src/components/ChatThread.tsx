import { IconAlertCircle, IconArrowDown, IconMessageChatbot, IconRefresh } from '@tabler/icons-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatMessage, QuickReply } from '../api/client'
import type { PendingMessage } from '../hooks/useSupportChat'
import { formatTime } from '../lib/format'
import { pillClass } from './ui'

interface ChatThreadProps {
  messages: ChatMessage[]
  pending: PendingMessage | null
  quickReplies: QuickReply[]
  onQuickReply: ((reply: QuickReply) => void) | null
  onRetry: (() => void) | null
  /** Cards rendered within the thread (claim form, decision). */
  children?: ReactNode
  /** Changes when the cards change, so the thread scrolls to show them. */
  contentKey: string
  /** Number of messages shown before the cards; later messages (follow-ups) follow them. */
  cardsAfter?: number
}

const NEAR_BOTTOM_PX = 80

export function ChatThread({ messages, pending, quickReplies, onQuickReply, onRetry, children, contentKey, cardsAfter = messages.length }: ChatThreadProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [unseen, setUnseen] = useState(false)
  const itemCount = messages.length + (pending ? 1 : 0)

  // Follow new content unless the customer has scrolled up to read earlier messages.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (pinned.current) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    else setUnseen(true)
  }, [itemCount, contentKey])

  const jumpToLatest = () => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
    pinned.current = true
    setUnseen(false)
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
          if (pinned.current) setUnseen(false)
        }}
        className="relative h-full space-y-4 overflow-y-auto px-4 py-5"
      >
        <MessageList label="Conversation" messages={messages.slice(0, cardsAfter)} />
        {children}
        <MessageList label="Follow-up messages" messages={messages.slice(cardsAfter)}>
          {pending && <MessageBubble role="CUSTOMER" text={pending.label} time={pending.failed ? 'Not sent' : 'Sending…'} failed={pending.failed} />}
          {pending && !pending.failed && <TypingIndicator />}
        </MessageList>

        {pending?.failed && onRetry && (
          <div className="flex justify-end">
            <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 text-sm font-medium text-rose-700 hover:underline">
              <IconRefresh size={16} aria-hidden="true" /> Retry sending
            </button>
          </div>
        )}

        {!pending && onQuickReply && quickReplies.length > 0 && (
          <div className="flex flex-wrap gap-2 pl-10" role="group" aria-label="Suggested replies">
            {quickReplies.map((reply) => (
              <button key={`${reply.kind}-${reply.label}`} type="button" onClick={() => onQuickReply(reply)} className={`${pillClass} border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50`}>
                {reply.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {unseen && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-indigo-600 px-3 py-1.5 text-sm text-white shadow-lg"
        >
          <IconArrowDown size={16} aria-hidden="true" /> New message
        </button>
      )}
    </div>
  )
}

function MessageList({ label, messages, children }: { label: string; messages: ChatMessage[]; children?: ReactNode }) {
  if (messages.length === 0 && !children) return null
  return (
    <ol aria-live="polite" aria-label={label} className="space-y-3">
      {messages.map((m) => (
        <MessageBubble key={m.id} role={m.role} text={m.text} time={formatTime(m.createdAt)} />
      ))}
      {children}
    </ol>
  )
}

function AssistantAvatar() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700" aria-hidden="true">
      <IconMessageChatbot size={18} />
    </span>
  )
}

function MessageBubble({ role, text, time, failed = false }: { role: ChatMessage['role']; text: string; time: string; failed?: boolean }) {
  const mine = role === 'CUSTOMER'
  return (
    <li className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine && <AssistantAvatar />}
      <div className={`flex max-w-[80%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
        <p
          className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
            mine ? `rounded-br-sm text-white ${failed ? 'bg-rose-500' : 'bg-indigo-600'}` : 'rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200'
          }`}
        >
          <span className="sr-only">{mine ? 'You: ' : 'Assistant: '}</span>
          {text}
        </p>
        <span className={`mt-1 flex items-center gap-1 text-[11px] ${failed ? 'text-rose-600' : 'text-slate-400'}`}>
          {failed && <IconAlertCircle size={12} aria-hidden="true" />}
          {time}
        </span>
      </div>
    </li>
  )
}

function TypingIndicator() {
  return (
    <li className="flex items-center gap-2" aria-label="Assistant is typing">
      <AssistantAvatar />
      <span className="flex gap-1 rounded-2xl rounded-bl-sm bg-white px-4 py-3 ring-1 ring-slate-200" aria-hidden="true">
        {['[animation-delay:0ms]', '[animation-delay:150ms]', '[animation-delay:300ms]'].map((delay) => (
          <span key={delay} className={`size-1.5 rounded-full bg-slate-400 motion-safe:animate-bounce ${delay}`} />
        ))}
      </span>
    </li>
  )
}
