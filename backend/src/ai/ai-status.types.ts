/** ok: the provider answered its last check; degraded: it is failing; disabled: no API key configured. */
export type AiStatus = 'ok' | 'degraded' | 'disabled';

export interface AiStatusReport {
  status: AiStatus;
  provider: string | null;
  model: string | null;
}
