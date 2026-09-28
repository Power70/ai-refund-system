import type { Env } from '../config/env.js';
import type { LlmConfig, ProviderId, Protocol } from './llm.types.js';

interface ProviderDefaults {
  protocol: Protocol;
  baseUrl: string;
  model: string;
}

// Default models verified against provider documentation (September 2026). Override with LLM_MODEL.
export const PROVIDERS: Record<Exclude<ProviderId, 'openai-compatible'>, ProviderDefaults> = {
  anthropic: { protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-4-5-20251001' },
  openai: { protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
  gemini: { protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.5-flash' },
  groq: { protocol: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  openrouter: { protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5-mini' },
};

const KEY_PREFIXES: [prefix: string, provider: ProviderId][] = [
  ['sk-ant-', 'anthropic'],
  ['sk-or-', 'openrouter'],
  ['gsk_', 'groq'],
  ['AIza', 'gemini'],
  // Google AI Studio's newer key format.
  ['AQ.', 'gemini'],
  ['sk-', 'openai'],
];

export type LlmConfigResult = { enabled: true; config: LlmConfig } | { enabled: false; reason: string };

/**
 * Resolves the provider from LLM_PROVIDER, LLM_BASE_URL or the key prefix, in that order.
 * An unrecognised setup disables AI instead of failing startup.
 */
export function resolveLlmConfig(env: Pick<Env, 'LLM_API_KEY' | 'LLM_PROVIDER' | 'LLM_BASE_URL' | 'LLM_MODEL' | 'AI_TIMEOUT_MS'>): LlmConfigResult {
  const apiKey = present(env.LLM_API_KEY);
  if (!apiKey) return { enabled: false, reason: 'LLM_API_KEY is not set' };

  const customBaseUrl = present(env.LLM_BASE_URL);
  const provider: ProviderId | undefined =
    (present(env.LLM_PROVIDER) as ProviderId | undefined) ??
    (customBaseUrl ? 'openai-compatible' : KEY_PREFIXES.find(([prefix]) => apiKey.startsWith(prefix))?.[1]);
  if (!provider) return { enabled: false, reason: 'Unrecognised API key format; set LLM_PROVIDER or LLM_BASE_URL' };

  const defaults = provider === 'openai-compatible' ? undefined : PROVIDERS[provider];
  const baseUrl = (customBaseUrl ?? defaults?.baseUrl)?.replace(/\/+$/, '');
  const model = present(env.LLM_MODEL) ?? defaults?.model;
  if (!baseUrl || !model) return { enabled: false, reason: 'LLM_BASE_URL and LLM_MODEL are required for an OpenAI-compatible provider' };

  return { enabled: true, config: { provider, protocol: defaults?.protocol ?? 'openai', baseUrl, model, apiKey, timeoutMs: env.AI_TIMEOUT_MS } };
}

/** The trimmed value, or undefined when blank: an empty setting means "not set". */
function present(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

/**
 * Reasoning models (OpenAI o-series, GPT-5 family) reject a custom temperature, and Google
 * advises keeping Gemini 3 models at their default temperature.
 */
export function acceptsTemperature(model: string): boolean {
  return !/(^|\/)(o\d|gpt-5|gemini-3)/.test(model);
}
