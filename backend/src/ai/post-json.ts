import { LlmError } from './llm.types.js';

const MAX_ERROR_DETAIL = 200;

/**
 * POSTs JSON and maps failures to LlmError. The API key is removed from any error text,
 * since some providers echo part of it back.
 */
export async function postJson<T>(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal, apiKey: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (error) {
    if (signal.aborted) throw new LlmError('timeout', 'Request timed out');
    throw new LlmError('network', `Network error: ${(error as Error).message}`);
  }

  if (!response.ok) {
    const detail = redact((await response.text().catch(() => '')).slice(0, MAX_ERROR_DETAIL), apiKey);
    throw new LlmError(kindForStatus(response.status), `HTTP ${response.status}: ${detail}`, response.status);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new LlmError('invalid_response', 'Response body was not JSON');
  }
}

function kindForStatus(status: number) {
  if (status === 401 || status === 403) return 'auth' as const;
  if (status === 429) return 'rate_limit' as const;
  if (status === 408 || status >= 500) return 'unavailable' as const;
  return 'bad_request' as const;
}

function redact(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join('[redacted]') : text;
}
