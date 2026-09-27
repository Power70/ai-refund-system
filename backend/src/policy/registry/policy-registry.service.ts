import { readFile } from 'node:fs/promises';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DATABASE } from '../../database/database.tokens.js';
import type { Database } from '../../database/database.types.js';
import { parsePolicy } from '../parse-policy.js';
import type { RegisteredPolicy } from './active-policy.types.js';
import { findActivePolicy } from './find-active-policy.js';
import { POLICY_FILE_PATH } from './policy-file-path.token.js';
import { registerPolicyVersion } from './register-policy-version.js';

@Injectable()
export class PolicyRegistryService implements OnModuleInit {
  private readonly logger = new Logger(PolicyRegistryService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(POLICY_FILE_PATH) private readonly policyFilePath: string,
  ) {}

  /**
   * Startup: validate the policy file, register its version, and make sure some policy
   * is in force right now. Any problem stops the API from starting, with the reason.
   */
  async onModuleInit(): Promise<void> {
    const document = parsePolicy(await readFile(this.policyFilePath, 'utf8'));
    const { policy, created } = await registerPolicyVersion(this.db, document);
    this.logger.log(`Refund policy "${policy.version}" ${created ? 'registered' : 'already registered'} (${policy.contentHash.slice(0, 12)}…)`);

    const active = await this.getActivePolicy(new Date());
    if (active.id !== policy.id) {
      this.logger.warn(`Policy "${policy.version}" takes effect ${policy.effectiveFrom.toISOString()}; "${active.version}" is in force until then.`);
    }
  }

  /** The policy that decides a request submitted at `at` (defaults to now). */
  getActivePolicy(at: Date = new Date()): Promise<RegisteredPolicy> {
    return findActivePolicy(this.db, at);
  }
}
