import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

export interface PolledData<T> {
  data: T | null
  error: unknown
  /** Loads again now (e.g. after a change the user made). */
  reload: () => void
}

/**
 * Loads data on mount, whenever `key` changes, and every `intervalMs`.
 * An in-flight load is aborted when a newer one starts or the component unmounts.
 */
export function usePolledData<T>(load: (signal: AbortSignal) => Promise<T>, key: string, intervalMs: number): PolledData<T> {
  const [state, setState] = useState<{ data: T | null; error: unknown }>({ data: null, error: null })
  const [tick, setTick] = useState(0)
  const loadRef = useRef(load)

  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    let controller = new AbortController()
    const run = () => {
      controller.abort()
      controller = new AbortController()
      const { signal } = controller
      loadRef.current(signal).then(
        (data) => !signal.aborted && setState({ data, error: null }),
        (error: unknown) => !signal.aborted && setState((s) => ({ ...s, error })),
      )
    }
    const timer = window.setTimeout(run, 0)
    const interval = window.setInterval(run, intervalMs)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(interval)
      controller.abort()
    }
  }, [key, tick, intervalMs])

  return { ...state, reload: () => setTick((t) => t + 1) }
}

export type ApiHealthState = 'checking' | 'ok' | 'degraded' | 'unreachable'

/** Whether the API is reachable, checked every 15 seconds. */
export function useApiHealth(): ApiHealthState {
  const { data, error } = usePolledData((signal) => api.health(signal), 'health', 15_000)
  return error ? 'unreachable' : (data ?? 'checking')
}
