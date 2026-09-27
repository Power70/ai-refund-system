import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type ChatInput, type ClaimSubmission, type Conversation, type RefundRequestView } from '../api/client'

export const STORAGE_KEY = 'refund-support:conversation'
const POLL_MS = 1_500
const POLL_LIMIT = 40

export interface PendingMessage {
  clientMessageId: string
  label: string
  input: ChatInput
  failed: boolean
}

export interface ChatError {
  message: string
  retry?: () => void
}

function readStoredId(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function storeId(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id)
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode): the chat simply isn't restored after a refresh.
  }
}

export const errorMessage = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong. Please try again.')

/** Conversation, pending message, submission and decision state for the customer workspace. */
export function useSupportChat(onRequestChanged: () => void) {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [pending, setPending] = useState<PendingMessage | null>(null)
  const [request, setRequest] = useState<RefundRequestView | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<ChatError | null>(null)
  const pollTimer = useRef<number | undefined>(undefined)
  const fail = (error: unknown, retry: () => void) => setError({ message: errorMessage(error), retry })

  const pollRequest = useCallback(
    function pollRequest(requestId: string, attempt = 0) {
      window.clearTimeout(pollTimer.current)
      pollTimer.current = window.setTimeout(async () => {
        try {
          const view = await api.refundRequest(requestId)
          setRequest(view)
          if (view.status === 'PROCESSING' && attempt < POLL_LIMIT) pollRequest(requestId, attempt + 1)
          else onRequestChanged()
        } catch {
          if (attempt < POLL_LIMIT) pollRequest(requestId, attempt + 1)
        }
      }, POLL_MS)
    },
    [onRequestChanged],
  )

  const adopt = useCallback(
    async (next: Conversation) => {
      setConversation(next)
      storeId(next.conversationId)
      if (next.requestId) {
        const view = await api.refundRequest(next.requestId)
        setRequest(view)
        if (view.status === 'PROCESSING') pollRequest(view.requestId)
      } else {
        setRequest(null)
      }
    },
    [pollRequest],
  )

  const startNew = useCallback(async function startNew() {
    setError(null)
    setPending(null)
    window.clearTimeout(pollTimer.current)
    try {
      await adopt(await api.startConversation())
    } catch (e) {
      fail(e, () => void startNew())
    }
  }, [adopt])

  useEffect(() => {
    const stored = readStoredId()
    const restore = async () => {
      try {
        if (stored) return await adopt(await api.conversation(stored))
      } catch {
        storeId(null)
      }
      await startNew()
    }
    void restore()
    return () => window.clearTimeout(pollTimer.current)
  }, [adopt, startNew])

  const deliver = useCallback(
    async function deliver(message: PendingMessage) {
      if (!conversation) return
      setError(null)
      setPending({ ...message, failed: false })
      try {
        const next = await api.sendMessage(conversation.conversationId, message.clientMessageId, message.input)
        setConversation(next)
        setPending(null)
      } catch (e) {
        // Keep the message and its id: a retry is deduplicated by the server.
        setPending({ ...message, failed: true })
        fail(e, () => void deliver(message))
      }
    },
    [conversation],
  )

  const send = useCallback(
    (input: ChatInput, label: string) => {
      if (pending && !pending.failed) return
      void deliver({ clientMessageId: crypto.randomUUID(), label, input, failed: false })
    },
    [deliver, pending],
  )

  const submit = useCallback(
    async function submit(claim: Omit<ClaimSubmission, 'conversationId'>, idempotencyKey: string) {
      if (!conversation) return
      setSubmitting(true)
      setError(null)
      try {
        const view = await api.submitClaim({ ...claim, conversationId: conversation.conversationId }, idempotencyKey)
        setRequest(view)
        setConversation(await api.conversation(conversation.conversationId))
        if (view.status === 'PROCESSING') pollRequest(view.requestId)
        else onRequestChanged()
      } catch (e) {
        fail(e, () => void submit(claim, idempotencyKey))
      } finally {
        setSubmitting(false)
      }
    },
    [conversation, onRequestChanged, pollRequest],
  )

  return { conversation, pending, request, submitting, error, send, submit, startNew, dismissError: () => setError(null) }
}
