import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
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
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard.js';
import { ParsePublicRequestIdPipe } from '../common/validation.js';
import { DetailedHealthDto } from '../health/dto/health.dto.js';
import { HealthService } from '../health/health.service.js';
import { AdminService } from './admin.service.js';
import { AdminCustomersService } from './customers.service.js';
import { AdminCustomerDetailDto, AdminCustomerListDto, AdminCustomersQueryDto, AdminMetricsDto, AdminQueueDto, AdminQueueQueryDto, CaseBriefDto, ResolveEscalationDto } from './dto/admin.dto.js';
import { ResolutionService } from './resolution.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Not signed in, or wrong admin password' })
@ApiTooManyRequestsResponse({ description: 'Too many wrong passwords from this IP' })
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly resolutions: ResolutionService,
    private readonly health: HealthService,
    private readonly customers: AdminCustomersService,
  ) {}

  @Get('customers')
  @ApiOkResponse({ type: AdminCustomerListDto })
  customerList(@Query() query: AdminCustomersQueryDto): Promise<AdminCustomerListDto> {
    return this.customers.list(query);
  }

  @Get('customers/:customerId')
  @ApiOkResponse({ type: AdminCustomerDetailDto })
  @ApiNotFoundResponse()
  async customer(@Param('customerId', new ParseUUIDPipe()) customerId: string): Promise<AdminCustomerDetailDto> {
    const detail = await this.customers.detail(customerId);
    if (!detail) throw new NotFoundException('Customer not found.');
    return detail;
  }

  @Get('refund-requests')
  @ApiOkResponse({ type: AdminQueueDto })
  queue(@Query() query: AdminQueueQueryDto): Promise<AdminQueueDto> {
    return this.admin.queue(query);
  }

  @Get('refund-requests/:requestId')
  @ApiOkResponse({ type: CaseBriefDto })
  @ApiNotFoundResponse()
  async caseBrief(@Param('requestId', ParsePublicRequestIdPipe) requestId: string): Promise<CaseBriefDto> {
    const brief = await this.admin.caseBrief(requestId);
    if (!brief) throw new NotFoundException('Request not found.');
    return brief;
  }

  @Post('refund-requests/:requestId/resolution')
  @HttpCode(200)
  @ApiOkResponse({ type: CaseBriefDto, description: 'The updated case brief' })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'NOT_ESCALATED or ALREADY_RESOLVED' })
  @ApiUnprocessableEntityResponse({ description: 'LINES_MISMATCH: every line must be decided exactly once' })
  async resolve(@Param('requestId', ParsePublicRequestIdPipe) requestId: string, @Body() body: ResolveEscalationDto): Promise<CaseBriefDto> {
    await this.resolutions.resolve(requestId, body);
    return (await this.admin.caseBrief(requestId))!;
  }

  @Get('metrics')
  @ApiOkResponse({ type: AdminMetricsDto })
  metrics(): Promise<AdminMetricsDto> {
    return this.admin.metrics();
  }

  /** Always 200; liveness uses the public /health endpoint. */
  @Get('health')
  @ApiOkResponse({ type: DetailedHealthDto })
  detailedHealth(): Promise<DetailedHealthDto> {
    return this.health.detailed();
  }
}
