import { acceptsTemperature, resolveLlmConfig } from './llm-providers.js';

type Input = Parameters<typeof resolveLlmConfig>[0];
const resolve = (overrides: Partial<Input>) => resolveLlmConfig({ AI_TIMEOUT_MS: 20_000, ...overrides });

describe('resolveLlmConfig', () => {
  it('is disabled without a key', () => {
    expect(resolve({})).toEqual({ enabled: false, reason: 'LLM_API_KEY is not set' });
    expect(resolve({ LLM_API_KEY: '   ' })).toMatchObject({ enabled: false });
  });

  it.each([
    ['sk-ant-api03-abc', 'anthropic', 'anthropic', 'https://api.anthropic.com', 'claude-haiku-4-5-20251001'],
    ['sk-or-v1-abc', 'openrouter', 'openai', 'https://openrouter.ai/api/v1', 'openai/gpt-5-mini'],
    ['gsk_abc', 'groq', 'openai', 'https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile'],
    ['AIzaSyabc', 'gemini', 'openai', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-3.5-flash'],
    ['sk-proj-abc', 'openai', 'openai', 'https://api.openai.com/v1', 'gpt-5-mini'],
  ])('detects %s as %s', (key, provider, protocol, baseUrl, model) => {
    expect(resolve({ LLM_API_KEY: key })).toEqual({ enabled: true, config: { provider, protocol, baseUrl, model, apiKey: key, timeoutMs: 20_000 } });
  });

  it('lets LLM_PROVIDER and LLM_MODEL override detection', () => {
    expect(resolve({ LLM_API_KEY: 'sk-abc', LLM_PROVIDER: 'openrouter', LLM_MODEL: 'anthropic/claude-sonnet-5' })).toMatchObject({
      config: { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-5' },
    });
  });

  it('treats a custom base URL as OpenAI-compatible and requires a model', () => {
    expect(resolve({ LLM_API_KEY: 'sk-deepseek', LLM_BASE_URL: 'https://api.deepseek.com/v1/' })).toMatchObject({ enabled: false });
    expect(resolve({ LLM_API_KEY: 'ollama', LLM_BASE_URL: 'http://host.docker.internal:11434/v1', LLM_MODEL: 'llama3.1' })).toMatchObject({
      config: { provider: 'openai-compatible', protocol: 'openai', baseUrl: 'http://host.docker.internal:11434/v1', model: 'llama3.1' },
    });
  });

  it('is disabled for an unrecognised key format', () => {
    expect(resolve({ LLM_API_KEY: 'abc123' })).toMatchObject({ enabled: false });
  });
});

describe('acceptsTemperature', () => {
  it.each([
    ['gpt-5-mini', false],
    ['openai/gpt-5-mini', false],
    ['o4-mini', false],
    ['claude-haiku-4-5-20251001', true],
    ['llama-3.3-70b-versatile', true],
    ['gemini-3.5-flash', true],
  ])('%s → %s', (model, expected) => {
    expect(acceptsTemperature(model)).toBe(expected);
  });
});
