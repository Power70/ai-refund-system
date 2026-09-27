import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { AiStatusService } from '../ai/ai-status.service.js';
import { DatabaseHealthService } from '../database/database-health.service.js';
import { DATABASE } from '../database/database.tokens.js';
import type { Database } from '../database/database.types.js';
import { PolicyRegistryService } from '../policy/registry/policy-registry.service.js';
import { countStuckRequests } from '../refunds/sweeper/count-stuck-requests.js';
import { checkAdminHealth } from './health/check-admin-health.js';
import { AdminHealthDto } from './health/dto/admin-health.dto.js';
import { AdminMetricsDto } from './metrics/dto/admin-metrics.dto.js';
import { loadAdminMetrics } from './metrics/load-admin-metrics.js';

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
    private readonly aiStatus: AiStatusService,
  ) {}

  @Get('metrics')
  @ApiOkResponse({ type: AdminMetricsDto })
  metrics(): Promise<AdminMetricsDto> {
    return loadAdminMetrics(this.db, this.aiStatus.report());
  }

  /** Always 200 with details; the public /health is what load balancers watch. */
  @Get('health')
  @ApiOkResponse({ type: AdminHealthDto })
  health(): Promise<AdminHealthDto> {
    return checkAdminHealth({
      databaseReachable: () => this.database.isReachable(),
      activePolicyVersion: async () => (await this.policies.getActivePolicy()).version,
      stuckCount: () => countStuckRequests(this.db),
      ai: () => this.aiStatus.report(),
    });
  }
}
