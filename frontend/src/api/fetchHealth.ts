export type HealthStatus = 'ok' | 'degraded'

export interface HealthResponse {
  status: HealthStatus
}

/** Calls the public liveness endpoint through the same-origin /api proxy. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch('/api/v1/health', { signal, headers: { Accept: 'application/json' } })
  // 503 means the API is up but a dependency (the database) is not: report it as degraded.
  if (res.status === 503) return { status: 'degraded' }
  if (!res.ok) {
    throw new Error(`Health check failed with status ${res.status}`)
  }
  return (await res.json()) as HealthResponse
}
