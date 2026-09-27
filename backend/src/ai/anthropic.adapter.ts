import { postJson } from './post-json.js';
import { LlmError, type LlmAdapter, type LlmConfig, type ToolCallRequest, type ToolCallResult } from './llm.types.js';

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
