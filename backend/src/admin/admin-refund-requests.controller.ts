import { Controller, Get, Inject, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { DATABASE } from '../database/database.tokens.js';
import type { Database } from '../database/database.types.js';
import { AdminQueueQueryDto } from './dto/admin-queue-query.dto.js';
import { AdminQueueDto } from './dto/admin-queue.dto.js';
import { CaseBriefDto } from './dto/case-brief.dto.js';
import { listAdminQueue } from './list-admin-queue.js';
import { loadCaseBrief } from './load-case-brief.js';

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
}
