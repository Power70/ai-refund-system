import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { DATABASE } from '../database/database.tokens.js';
import type { Database } from '../database/database.types.js';
import { AdminQueueQueryDto } from './dto/admin-queue-query.dto.js';
import { AdminQueueDto } from './dto/admin-queue.dto.js';
import { CaseBriefDto } from './dto/case-brief.dto.js';
import { listAdminQueue } from './list-admin-queue.js';
import { loadCaseBrief } from './load-case-brief.js';
import { ResolveEscalationDto } from './resolution/dto/resolve-escalation.dto.js';
import { resolveEscalation } from './resolution/resolve-escalation.js';

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
