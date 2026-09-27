import { useEffect, useState } from 'react'
import { api } from '../api/client'

export type ApiHealthState = 'checking' | 'ok' | 'degraded' | 'unreachable'

const POLL_INTERVAL_MS = 15_000

/** Polls the API liveness endpoint so the shell shows whether the backend is reachable. */
export function useApiHealth(): ApiHealthState {
  const [state, setState] = useState<ApiHealthState>('checking')

  useEffect(() => {
    let controller = new AbortController()

    const check = async () => {
      controller.abort()
      controller = new AbortController()
      try {
        setState(await api.health(controller.signal))
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState('unreachable')
        }
      }
    }

    void check()
    const timer = window.setInterval(() => void check(), POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      controller.abort()
    }
  }, [])

  return state
}
