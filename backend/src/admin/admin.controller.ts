import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import { AdminAuthGuard } from '../admin-auth/admin-auth.js';
import { LlmService } from '../ai/llm.service.js';
import { DATABASE, DatabaseHealthService, type Database } from '../database/database.js';
import { PolicyRegistryService } from '../policy/policy-registry.js';
import { countStuckRequests } from '../refunds/request-sweeper.js';
import { listAdminQueue, loadCaseBrief, checkAdminHealth, loadAdminMetrics } from './admin-queries.js';
import { resolveEscalation } from './admin-resolution.js';
import { AdminQueueQueryDto, AdminQueueDto, CaseBriefDto, ResolveEscalationDto, AdminHealthDto, AdminMetricsDto } from './admin.dto.js';

const PUBLIC_ID = /^rr_[0-9a-hjkmnp-tv-z]{12}$/;

@ApiTags('admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or wrong admin token' })
@ApiTooManyRequestsResponse({ description: 'Too many wrong tokens from this IP' })
@Controller('admin/refund-requests')
@UseGuards(AdminAuthGuard)
export class AdminRefundRequestsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @ApiOkResponse({ type: AdminQueueDto })
  list(@Query() query: AdminQueueQueryDto): Promise<AdminQueueDto> {
    return listAdminQueue(this.db, query);
  }

  @Get(':requestId')
  @ApiOkResponse({ type: CaseBriefDto })
  @ApiNotFoundResponse()
  async brief(@Param('requestId') requestId: string): Promise<CaseBriefDto> {
    const brief = PUBLIC_ID.test(requestId) ? await loadCaseBrief(this.db, requestId) : null;
    if (!brief) throw new NotFoundException('Request not found.');
    return brief;
  }

  @Post(':requestId/resolution')
  @HttpCode(200)
  @ApiOkResponse({ type: CaseBriefDto, description: 'The updated case brief' })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'NOT_ESCALATED or ALREADY_RESOLVED' })
  @ApiUnprocessableEntityResponse({ description: 'LINES_MISMATCH: every line must be decided exactly once' })
  async resolve(@Param('requestId') requestId: string, @Body() body: ResolveEscalationDto): Promise<CaseBriefDto> {
    if (!PUBLIC_ID.test(requestId)) throw new NotFoundException('Request not found.');
    await resolveEscalation(this.db, requestId, body);
    return (await loadCaseBrief(this.db, requestId))!;
  }
}

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
