import type { AssistantTurn } from '../../src/conversations/assistant-turn.js';
import { LlmError, type LlmAdapter, type ToolCallRequest, type ToolCallResult } from '../../src/ai/llm.types.js';

// An output, an LlmError to throw, or a function of the request.
type Scripted = unknown;

/** Scripted model: answers the startup probe and case summaries itself; chat turns come from the queue. */
export class FakeLlm implements LlmAdapter {
  readonly requests: ToolCallRequest[] = [];
  private readonly queue: Scripted[] = [];

  next(...outputs: Scripted[]): this {
    this.queue.push(...outputs);
    return this;
  }

  /** Returned for case-summary calls, which run in the background after submissions. */
  summary: unknown = { summary: 'Customer reports a problem with the item.', suggestedAction: 'NEEDS_INFO', rationale: 'Details need checking.' };

  async callTool(request: ToolCallRequest): Promise<ToolCallResult> {
    if (request.toolName === 'report_ready') return { input: { ready: true } };
    if (request.toolName === 'record_case_summary') return { input: this.summary, inputTokens: 200, outputTokens: 40 };
    this.requests.push(request);
    const scripted = this.queue.shift();
    if (scripted === undefined) throw new LlmError('unavailable', 'FakeLlm: nothing queued');
    if (scripted instanceof LlmError) throw scripted;
    return { input: typeof scripted === 'function' ? (scripted as (r: ToolCallRequest) => unknown)(request) : scripted, inputTokens: 100, outputTokens: 50 };
  }
}

const NO_FLAGS = { injectionAttempt: false, mentionsOtherCustomerOrder: false, abusive: false, offTopic: false };

/** A valid chat turn with defaults; override what the test cares about. */
export function turn(overrides: Partial<AssistantTurn> = {}): AssistantTurn {
  return { reply: 'Which item is this about?', quickReplies: [], needsClarification: true, proposal: null, flags: NO_FLAGS, summary: 'Customer started a refund chat.', ...overrides };
}

/** Finds an item ref ("O1.I2") in the prompt by item name. */
export function refFor(request: ToolCallRequest, itemName: string): { orderRef: string; itemRef: string } {
  const line = request.user.split('\n').find((l) => l.includes(`"${itemName}"`));
  const itemRef = line?.trim().split(' ')[0];
  if (!itemRef) throw new Error(`no ref for ${itemName}`);
  return { orderRef: itemRef.split('.')[0], itemRef };
}
