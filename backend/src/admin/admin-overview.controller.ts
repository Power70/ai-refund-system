import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { LlmService } from '../ai/llm.service.js';
import { DatabaseHealthService } from '../database/database-health.service.js';
import { DATABASE } from '../database/database.tokens.js';
import type { Database } from '../database/database.types.js';
import { PolicyRegistryService } from '../policy/registry/policy-registry.service.js';
import { countStuckRequests } from '../refunds/sweeper/count-stuck-requests.js';
import { checkAdminHealth } from './admin-health.js';
import { loadAdminMetrics } from './admin-metrics.js';
import { AdminHealthDto, AdminMetricsDto } from './admin-overview.dto.js';

@ApiTags('admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or wrong admin token' })
@ApiTooManyRequestsResponse({ description: 'Too many wrong tokens from this IP' })
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminOverviewController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly database: DatabaseHealthService,
    private readonly policies: PolicyRegistryService,
    private readonly llm: LlmService,
  ) {}

  @Get('metrics')
  @ApiOkResponse({ type: AdminMetricsDto })
  metrics(): Promise<AdminMetricsDto> {
    return loadAdminMetrics(this.db, this.llm.report());
  }

  /** Always 200; the public /health endpoint is the one used for liveness. */
  @Get('health')
  @ApiOkResponse({ type: AdminHealthDto })
  health(): Promise<AdminHealthDto> {
    return checkAdminHealth({
      databaseReachable: () => this.database.isReachable(),
      activePolicyVersion: async () => (await this.policies.getActivePolicy()).version,
      stuckCount: () => countStuckRequests(this.db),
      ai: () => this.llm.report(),
    });
  }
}
