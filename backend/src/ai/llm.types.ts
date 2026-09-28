export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'groq' | 'openrouter' | 'openai-compatible';
export type Protocol = 'anthropic' | 'openai' | 'gemini';

export interface LlmConfig {
  provider: ProviderId;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  /** Anthropic only: sent as anthropic-workspace-id for keys not scoped to a workspace. */
  workspaceId?: string;
}

/** A single forced tool call; the tool's parameters are the output schema. */
export interface ToolCallRequest {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  parameters: Record<string, unknown>;
  temperature?: number;
  signal: AbortSignal;
}

export interface ToolCallResult {
  input: unknown;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmAdapter {
  callTool(request: ToolCallRequest): Promise<ToolCallResult>;
}

export type LlmErrorKind = 'auth' | 'rate_limit' | 'unavailable' | 'timeout' | 'network' | 'bad_request' | 'invalid_response';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }

  get retryable(): boolean {
    return this.kind === 'rate_limit' || this.kind === 'unavailable' || this.kind === 'network';
  }
}

export type AiStatus = 'ok' | 'degraded' | 'disabled';

export interface AiStatusReport {
  status: AiStatus;
  provider: ProviderId | null;
  model: string | null;
  lastError: LlmErrorKind | 'invalid_output' | null;
}

export type StructuredResult<T> =
  | { ok: true; value: T; attempts: number; latencyMs: number; inputTokens?: number; outputTokens?: number }
  | { ok: false; reason: LlmErrorKind | 'invalid_output' | 'disabled'; attempts: number; latencyMs: number };
