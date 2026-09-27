import { Injectable } from '@nestjs/common';
import type { AiStatusReport } from './ai-status.types.js';

/**
 * Where the rest of the app asks "is the AI usable right now?". No model is wired in yet,
 * so it reports `disabled`, the same mode the app runs in when no LLM_API_KEY is set:
 * the policy still decides, and would-be approvals go to a person. The LLM adapter bit
 * replaces this with the result of its startup probe and live call outcomes.
 */
@Injectable()
export class AiStatusService {
  report(): AiStatusReport {
    return { status: 'disabled', provider: null, model: null };
  }
}
