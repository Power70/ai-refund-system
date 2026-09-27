import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import { DATABASE } from '../../database/database.tokens.js';
import type { Database } from '../../database/database.types.js';
import { sweepStuckRequests } from './sweep-stuck-requests.js';
import type { SweepResult } from './sweep-result.types.js';
import { SWEEPER_INTERVAL_MS } from './sweeper-interval.token.js';

/** Runs the sweep on a timer. Passes never overlap; a failed pass is logged and retried next tick. */
@Injectable()
export class RequestSweeperService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RequestSweeperService.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<SweepResult | null> | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SWEEPER_INTERVAL_MS) private readonly intervalMs: number,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (this.intervalMs <= 0) return;
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running; // let an in-flight pass finish before the pool closes
  }

  sweep(): Promise<SweepResult | null> {
    if (this.running) return this.running;
    this.running = sweepStuckRequests(this.db, { minConfidence: this.config.get('AI_MIN_CONFIDENCE', { infer: true }) })
      .then((result) => {
        if (result.found > 0) this.logger.log(`Swept ${result.found}: ${result.decided} decided, ${result.escalated} escalated, ${result.retryLater} to retry`);
        return result;
      })
      .catch((error: unknown) => {
        this.logger.error(`Sweep failed: ${(error as Error).message}`);
        return null;
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
}
