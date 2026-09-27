import { LlmError, type LlmAdapter, type LlmConfig, type ToolCallRequest, type ToolCallResult } from './llm.types.js';

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

interface ChatCompletion {
  choices?: { message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** OpenAI Chat Completions protocol: OpenAI, Gemini, Groq, OpenRouter, DeepSeek, Mistral, Ollama. */
export class OpenAiCompatibleAdapter implements LlmAdapter {
  constructor(private readonly config: LlmConfig) {}

  async callTool(request: ToolCallRequest): Promise<ToolCallResult> {
    const body = {
      model: this.config.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      tools: [{ type: 'function', function: { name: request.toolName, description: request.toolDescription, parameters: request.parameters } }],
      tool_choice: { type: 'function', function: { name: request.toolName } },
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    };
    const response = await postJson<ChatCompletion>(
      `${this.config.baseUrl}/chat/completions`,
      { Authorization: `Bearer ${this.config.apiKey}` },
      body,
      request.signal,
      this.config.apiKey,
    );

    const message = response.choices?.[0]?.message;
    const call = message?.tool_calls?.find((c) => c.function?.name === request.toolName) ?? message?.tool_calls?.[0];
    // Some providers ignore a forced tool choice and answer in plain content; accept JSON there too.
    const raw = call?.function?.arguments ?? message?.content;
    if (!raw) throw new LlmError('invalid_response', 'Response contained no tool call or content');
    return { input: parseJson(raw), inputTokens: response.usage?.prompt_tokens, outputTokens: response.usage?.completion_tokens };
  }
}

function parseJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(text);
  } catch {
    throw new LlmError('invalid_response', 'Tool arguments were not valid JSON');
  }
}

const API_VERSION = '2023-06-01';
const MAX_TOKENS = 1024;

interface MessagesResponse {
  content?: { type: string; name?: string; input?: unknown }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Anthropic Messages API with a forced tool call. */
export class AnthropicAdapter implements LlmAdapter {
  constructor(private readonly config: LlmConfig) {}

  async callTool(request: ToolCallRequest): Promise<ToolCallResult> {
    const body = {
      model: this.config.model,
      max_tokens: MAX_TOKENS,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
      tools: [{ name: request.toolName, description: request.toolDescription, input_schema: request.parameters }],
      tool_choice: { type: 'tool', name: request.toolName },
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    };
    const response = await postJson<MessagesResponse>(
      `${this.config.baseUrl}/v1/messages`,
      { 'x-api-key': this.config.apiKey, 'anthropic-version': API_VERSION },
      body,
      request.signal,
      this.config.apiKey,
    );

    const block = response.content?.find((c) => c.type === 'tool_use' && c.name === request.toolName);
    if (!block) throw new LlmError('invalid_response', 'Response contained no tool call');
    return { input: block.input, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens };
  }
}
