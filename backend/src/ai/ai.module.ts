import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { AnthropicAdapter, OpenAiCompatibleAdapter } from './llm-adapters.js';
import { resolveLlmConfig, type LlmConfigResult } from './llm-providers.js';
import { LLM_ADAPTER, LLM_CONFIG, LlmService } from './llm.service.js';

@Global()
@Module({
  providers: [
    {
      provide: LLM_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): LlmConfigResult =>
        resolveLlmConfig({
          LLM_API_KEY: config.get('LLM_API_KEY', { infer: true }),
          LLM_PROVIDER: config.get('LLM_PROVIDER', { infer: true }),
          LLM_BASE_URL: config.get('LLM_BASE_URL', { infer: true }),
          LLM_MODEL: config.get('LLM_MODEL', { infer: true }),
          AI_TIMEOUT_MS: config.get('AI_TIMEOUT_MS', { infer: true }),
        }),
    },
    {
      provide: LLM_ADAPTER,
      inject: [LLM_CONFIG],
      useFactory: (setup: LlmConfigResult) => {
        if (!setup.enabled) return null;
        return setup.config.protocol === 'anthropic' ? new AnthropicAdapter(setup.config) : new OpenAiCompatibleAdapter(setup.config);
      },
    },
    LlmService,
  ],
  exports: [LlmService],
})
export class AiModule {}
