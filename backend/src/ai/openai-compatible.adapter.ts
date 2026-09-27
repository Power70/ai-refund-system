import { postJson } from './post-json.js';
import { LlmError, type LlmAdapter, type LlmConfig, type ToolCallRequest, type ToolCallResult } from './llm.types.js';

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
