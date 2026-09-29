import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

export interface PolledData<T> {
  data: T | null
  error: unknown
  /** True until data for the current `key` arrives; `data` meanwhile still holds the previous key's result. */
  loading: boolean
  /** Loads again now (e.g. after a change the user made). */
  reload: () => void
}

/** Fixed delay between loads, or one chosen from the last outcome (e.g. retry sooner after a failure). */
export type PollInterval<T> = number | ((outcome: { data: T | null; error: unknown }) => number)

/**
 * Loads data on mount, whenever `key` changes, and then after each `intervalMs`.
 * An in-flight load is aborted when a newer one starts or the component unmounts.
 */
export function usePolledData<T>(load: (signal: AbortSignal) => Promise<T>, key: string, intervalMs: PollInterval<T>): PolledData<T> {
  const [state, setState] = useState<{ data: T | null; error: unknown; key: string | null }>({ data: null, error: null, key: null })
  const [tick, setTick] = useState(0)
  const loadRef = useRef(load)
  const intervalRef = useRef(intervalMs)

  useEffect(() => {
    loadRef.current = load
    intervalRef.current = intervalMs
  })

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    let timer: number | undefined
    const run = () => {
      const settle = (outcome: { data: T | null; error: unknown }) => {
        if (signal.aborted) return
        setState((s) => ({ data: outcome.error ? s.data : outcome.data, error: outcome.error, key }))
        const interval = intervalRef.current
        timer = window.setTimeout(run, typeof interval === 'function' ? interval(outcome) : interval)
      }
      loadRef.current(signal).then(
        (data) => settle({ data, error: null }),
        (error: unknown) => settle({ data: null, error }),
      )
    }
    timer = window.setTimeout(run, 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [key, tick])

  return { data: state.data, error: state.error, loading: state.key !== key, reload: () => setTick((t) => t + 1) }
}

export type ApiHealthState = 'checking' | 'ok' | 'degraded' | 'unreachable'

/** Whether the API is reachable: checked every 15 seconds, and every 3 while it is not. */
export function useApiHealth(): ApiHealthState {
  const { data, error } = usePolledData((signal) => api.health(signal), 'health', ({ data, error }) => (error || data === 'degraded' ? 3_000 : 15_000))
  return error ? 'unreachable' : (data ?? 'checking')
}
