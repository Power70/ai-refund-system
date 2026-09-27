import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';
import { acceptsTemperature, type LlmConfigResult } from './llm-providers.js';
import { LlmError, type AiStatusReport, type LlmAdapter, type LlmErrorKind, type StructuredResult } from './llm.types.js';

export const LLM_CONFIG = Symbol('LLM_CONFIG');
export const LLM_ADAPTER = Symbol('LLM_ADAPTER');

const RETRY_DELAY_MS = 250;
const MIN_RETRY_BUDGET_MS = 1_000;
const MAX_REPAIR_ISSUES = 5;

export interface StructuredRequest<T> {
  /** Tool name shown to the model, e.g. "record_turn". */
  name: string;
  description: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
}

const probeSchema = z.object({ ready: z.literal(true) }).strict();

/**
 * Provider-agnostic structured generation: one forced tool call validated with zod,
 * one retry on transient errors and one repair attempt on invalid output, all within AI_TIMEOUT_MS.
 * Never throws; callers treat any failure as "no AI assessment".
 */
@Injectable()
export class LlmService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LlmService.name);
  private status: AiStatusReport;
  private temperatureAllowed: boolean;

  constructor(
    @Inject(LLM_CONFIG) private readonly setup: LlmConfigResult,
    @Inject(LLM_ADAPTER) private readonly adapter: LlmAdapter | null,
  ) {
    const config = setup.enabled ? setup.config : null;
    this.status = { status: config && adapter ? 'ok' : 'disabled', provider: config?.provider ?? null, model: config?.model ?? null, lastError: null };
    this.temperatureAllowed = config ? acceptsTemperature(config.model) : false;
  }

  get enabled(): boolean {
    return this.status.status !== 'disabled';
  }

  report(): AiStatusReport {
    return { ...this.status };
  }

  onApplicationBootstrap(): void {
    if (!this.setup.enabled || !this.adapter) {
      this.logger.warn(`AI disabled (${this.setup.enabled ? 'no adapter' : this.setup.reason}); eligible refunds will be routed to a reviewer.`);
      return;
    }
    // Not awaited: a slow or failing provider must not delay startup.
    void this.probe();
  }

  async probe(): Promise<AiStatusReport> {
    const result = await this.generateStructured({
      name: 'report_ready',
      description: 'Confirm the service is reachable.',
      system: 'You are a health check. Call report_ready with ready set to true.',
      user: 'Health check.',
      schema: probeSchema,
    });
    const { provider, model } = this.status;
    if (result.ok) this.logger.log(`AI provider ${provider} (${model}) ready in ${result.latencyMs} ms.`);
    else this.logger.warn(`AI provider ${provider} (${model}) check failed: ${result.reason}. Refunds needing AI will be routed to a reviewer.`);
    return this.report();
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const started = Date.now();
    if (!this.setup.enabled || !this.adapter) return { ok: false, reason: 'disabled', attempts: 0, latencyMs: 0 };

    const { timeoutMs } = this.setup.config;
    const signal = AbortSignal.timeout(timeoutMs);
    const parameters = toToolParameters(request.schema);
    let user = request.user;
    let attempts = 0;
    let transportRetried = false;
    let repaired = false;

    for (;;) {
      attempts++;
      try {
        const result = await this.adapter.callTool({
          system: request.system,
          user,
          toolName: request.name,
          toolDescription: request.description,
          parameters,
          temperature: this.temperatureAllowed ? 0 : undefined,
          signal,
        });
        const parsed = request.schema.safeParse(result.input);
        if (parsed.success) {
          this.recordSuccess();
          return { ok: true, value: parsed.data, attempts, latencyMs: Date.now() - started, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
        }
        if (repaired) return this.fail('invalid_output', attempts, started);
        repaired = true;
        user = repairPrompt(request, describeIssues(parsed.error));
      } catch (error) {
        const failure = error instanceof LlmError ? error : new LlmError(signal.aborted ? 'timeout' : 'network', String(error));
        if (failure.kind === 'invalid_response' && !repaired) {
          repaired = true;
          user = repairPrompt(request, failure.message);
          continue;
        }
        if (failure.kind === 'bad_request' && this.temperatureAllowed && /temperature/i.test(failure.message)) {
          this.temperatureAllowed = false;
          this.logger.warn(`Model ${this.status.model} rejected a temperature setting; sending none from now on.`);
          continue;
        }
        const remaining = timeoutMs - (Date.now() - started);
        if (failure.retryable && !transportRetried && remaining > MIN_RETRY_BUDGET_MS) {
          transportRetried = true;
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        return this.fail(failure.kind === 'invalid_response' ? 'invalid_output' : failure.kind, attempts, started, failure.message);
      }
    }
  }

  private recordSuccess(): void {
    this.status = { ...this.status, status: 'ok', lastError: null };
  }

  private fail(reason: LlmErrorKind | 'invalid_output', attempts: number, started: number, detail?: string): StructuredResult<never> {
    // Error text from postJson is already stripped of the API key.
    this.logger.warn(`AI call failed after ${attempts} attempt(s): ${reason}${detail ? ` (${detail})` : ''}`);
    // Invalid output reflects model quality, not provider availability, so status is unchanged.
    this.status = { ...this.status, status: reason === 'invalid_output' ? this.status.status : 'degraded', lastError: reason };
    return { ok: false, reason, attempts, latencyMs: Date.now() - started };
  }
}

function toToolParameters(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(schema) as Record<string, unknown>;
  return parameters;
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, MAX_REPAIR_ISSUES)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function repairPrompt(request: StructuredRequest<unknown>, problem: string): string {
  return `${request.user}\n\nYour previous ${request.name} call was rejected (${problem}). Call ${request.name} again with arguments that match its schema exactly.`;
}
