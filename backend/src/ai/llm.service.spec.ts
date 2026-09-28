import { Logger } from '@nestjs/common';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { AnthropicAdapter, OpenAiCompatibleAdapter } from './llm-adapters.js';
import { acceptsTemperature, resolveLlmConfig, type LlmConfigResult } from './llm-providers.js';
import { LlmService } from './llm.service.js';
import type { LlmConfig } from './llm.types.js';

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

type Handler = (body: Record<string, unknown>, req: IncomingMessage, res: ServerResponse) => void;
interface Captured { url: string; headers: IncomingMessage['headers']; body: Record<string, unknown> }

const KEY = 'sk-test-secret-key-123';
const schema = z.object({ answer: z.enum(['yes', 'no']), confidence: z.number().min(0).max(1) }).strict();
const request = { name: 'record_answer', description: 'Record the answer.', system: 'Answer.', user: 'Is it damaged?', schema };

let server: Server;
let baseUrl: string;
let handlers: Handler[];
let captured: Captured[];

beforeAll(async () => {
  server = createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      const body = JSON.parse(data || '{}');
      captured.push({ url: req.url!, headers: req.headers, body });
      const handler = handlers.shift();
      if (handler) handler(body, req, res);
      else res.writeHead(500).end('no handler');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  handlers = [];
  captured = [];
});

const json = (status: number, payload: unknown): Handler => (_b, _r, res) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
const openAiToolCall = (args: unknown): Handler =>
  json(200, { choices: [{ message: { tool_calls: [{ function: { name: 'record_answer', arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 12, completion_tokens: 5 } });
const anthropicToolUse = (input: unknown): Handler =>
  json(200, { content: [{ type: 'tool_use', name: 'record_answer', input }], usage: { input_tokens: 10, output_tokens: 4 } });

function service(protocol: 'openai' | 'anthropic', overrides: Partial<LlmConfig> = {}) {
  const config: LlmConfig = {
    provider: protocol === 'anthropic' ? 'anthropic' : 'openai',
    protocol,
    baseUrl,
    model: protocol === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'llama-3.3-70b-versatile',
    apiKey: KEY,
    timeoutMs: 5_000,
    ...overrides,
  };
  const setup: LlmConfigResult = { enabled: true, config };
  return new LlmService(setup, protocol === 'anthropic' ? new AnthropicAdapter(config) : new OpenAiCompatibleAdapter(config));
}

describe('OpenAI-compatible adapter', () => {
  it('forces the tool call and returns validated output', async () => {
    handlers.push(openAiToolCall({ answer: 'yes', confidence: 0.97 }));
    const result = await service('openai').generateStructured(request);

    expect(result).toMatchObject({ ok: true, value: { answer: 'yes', confidence: 0.97 }, attempts: 1, inputTokens: 12, outputTokens: 5 });
    const [call] = captured;
    expect(call.url).toBe('/chat/completions');
    expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call.body).toMatchObject({
      model: 'llama-3.3-70b-versatile',
      temperature: 0,
      messages: [{ role: 'system', content: 'Answer.' }, { role: 'user', content: 'Is it damaged?' }],
      tool_choice: { type: 'function', function: { name: 'record_answer' } },
    });
    const parameters = (call.body.tools as { function: { parameters: Record<string, unknown> } }[])[0].function.parameters;
    expect(parameters).toMatchObject({ type: 'object', required: ['answer', 'confidence'], additionalProperties: false });
    expect(parameters.$schema).toBeUndefined();
  });

  it('omits temperature for reasoning models', async () => {
    handlers.push(openAiToolCall({ answer: 'no', confidence: 0.5 }));
    await service('openai', { model: 'gpt-5-mini' }).generateStructured(request);
    expect(captured[0].body).not.toHaveProperty('temperature');
  });

  it('accepts JSON content when a provider ignores the forced tool choice', async () => {
    handlers.push(json(200, { choices: [{ message: { content: '```json\n{"answer":"no","confidence":0.4}\n```' } }] }));
    expect(await service('openai').generateStructured(request)).toMatchObject({ ok: true, value: { answer: 'no', confidence: 0.4 } });
  });
});

describe('Anthropic adapter', () => {
  it('uses the Messages API with a forced tool', async () => {
    handlers.push(anthropicToolUse({ answer: 'yes', confidence: 0.99 }));
    const result = await service('anthropic').generateStructured(request);

    expect(result).toMatchObject({ ok: true, value: { answer: 'yes', confidence: 0.99 }, inputTokens: 10, outputTokens: 4 });
    const [call] = captured;
    expect(call.url).toBe('/v1/messages');
    expect(call.headers['x-api-key']).toBe(KEY);
    expect(call.headers['anthropic-version']).toBe('2023-06-01');
    expect(call.headers.authorization).toBeUndefined();
    expect(call.body).toMatchObject({
      model: 'claude-haiku-4-5-20251001',
      system: 'Answer.',
      max_tokens: 1024,
      tool_choice: { type: 'tool', name: 'record_answer' },
      messages: [{ role: 'user', content: 'Is it damaged?' }],
    });
  });
});

describe('LlmService', () => {
  it('asks once for a repair when output fails validation, then succeeds', async () => {
    handlers.push(anthropicToolUse({ answer: 'maybe', confidence: 2 }), anthropicToolUse({ answer: 'no', confidence: 0.8 }));
    const result = await service('anthropic').generateStructured(request);

    expect(result).toMatchObject({ ok: true, value: { answer: 'no' }, attempts: 2 });
    const repair = (captured[1].body.messages as { content: string }[])[0].content;
    expect(repair).toContain('Is it damaged?');
    expect(repair).toContain('answer:');
    expect(repair).toContain('confidence:');
  });

  it('gives up after one repair, without marking the provider degraded', async () => {
    handlers.push(anthropicToolUse({ answer: 'maybe' }), anthropicToolUse({ answer: 'maybe' }));
    const llm = service('anthropic');
    expect(await llm.generateStructured(request)).toMatchObject({ ok: false, reason: 'invalid_output', attempts: 2 });
    expect(llm.report()).toMatchObject({ status: 'ok', lastError: 'invalid_output' });
  });

  it('retries once on a transient error', async () => {
    handlers.push(json(503, { error: 'overloaded' }), openAiToolCall({ answer: 'yes', confidence: 1 }));
    expect(await service('openai').generateStructured(request)).toMatchObject({ ok: true, attempts: 2 });
  });

  it('stops after a second transient error and reports degraded', async () => {
    handlers.push(json(429, {}), json(429, {}));
    const llm = service('openai');
    expect(await llm.generateStructured(request)).toMatchObject({ ok: false, reason: 'rate_limit', attempts: 2 });
    expect(llm.report()).toMatchObject({ status: 'degraded', lastError: 'rate_limit' });
  });

  it('does not retry a rejected key, and recovers on the next success', async () => {
    handlers.push(json(401, { error: 'bad key' }));
    const llm = service('openai');
    expect(await llm.generateStructured(request)).toMatchObject({ ok: false, reason: 'auth', attempts: 1 });
    expect(llm.report().status).toBe('degraded');

    handlers.push(openAiToolCall({ answer: 'yes', confidence: 1 }));
    await llm.generateStructured(request);
    expect(llm.report()).toMatchObject({ status: 'ok', lastError: null });
  });

  it('drops temperature when a model rejects it, and remembers', async () => {
    handlers.push(json(400, { error: { message: "Unsupported value: 'temperature' does not support 0" } }), openAiToolCall({ answer: 'yes', confidence: 1 }));
    const llm = service('openai');
    expect(await llm.generateStructured(request)).toMatchObject({ ok: true, attempts: 2 });
    expect(captured[1].body).not.toHaveProperty('temperature');

    handlers.push(openAiToolCall({ answer: 'yes', confidence: 1 }));
    await llm.generateStructured(request);
    expect(captured[2].body).not.toHaveProperty('temperature');
  });

  it('times out within AI_TIMEOUT_MS', async () => {
    handlers.push(() => undefined); // never responds
    const started = Date.now();
    const result = await service('openai', { timeoutMs: 1_000 }).generateStructured(request);
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it('logs provider errors without the API key', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    handlers.push(json(401, { error: `Incorrect API key provided: ${KEY}` }));
    const llm = service('openai');
    const result = await llm.generateStructured(request);

    const logged = warn.mock.calls.map((args) => String(args[0])).join('\n');
    expect(logged).toContain('Incorrect API key provided: [redacted]');
    expect(logged).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(llm.report())).not.toContain(KEY);
    warn.mockRestore();
  });

  it('reports disabled and makes no calls without a key', async () => {
    const llm = new LlmService({ enabled: false, reason: 'LLM_API_KEY is not set' }, null);
    expect(await llm.generateStructured(request)).toEqual({ ok: false, reason: 'disabled', attempts: 0, latencyMs: 0 });
    expect(llm.report()).toEqual({ status: 'disabled', provider: null, model: null, lastError: null });
    expect(captured).toHaveLength(0);
  });

  it('probe reports the provider state', async () => {
    handlers.push(json(200, { content: [{ type: 'tool_use', name: 'report_ready', input: { ready: true } }] }));
    expect(await service('anthropic').probe()).toMatchObject({ status: 'ok', provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
    handlers.push(json(401, {}));
    expect(await service('anthropic').probe()).toMatchObject({ status: 'degraded', lastError: 'auth' });
  });
});
