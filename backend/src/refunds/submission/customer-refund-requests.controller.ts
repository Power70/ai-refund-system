import { Body, Controller, Get, Headers, HttpStatus, Inject, NotFoundException, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiAcceptedResponse, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiTags, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { SubmitRateLimit } from '../../common/rate-limit/rate-limit.decorators.js';
import { CurrentCustomerId } from '../../customer-auth/current-customer-id.decorator.js';
import { CustomerAuthGuard } from '../../customer-auth/customer-auth.guard.js';
import { SESSION_COOKIE } from '../../customer-auth/session-cookie.js';
import { DATABASE } from '../../database/database.tokens.js';
import type { Database } from '../../database/database.types.js';
import { CustomerRequestViewDto } from './dto/customer-request-view.dto.js';
import { SubmitRefundRequestDto } from './dto/submit-refund-request.dto.js';
import { listCustomerRequests } from './list-customer-requests.js';
import { loadCustomerRequestView } from './load-customer-request-view.js';
import { RefundSubmissionService } from './refund-submission.service.js';

const PUBLIC_ID = /^rr_[0-9a-hjkmnp-tv-z]{12}$/;

@ApiTags('customer refund requests')
@ApiCookieAuth(SESSION_COOKIE)
@Controller('customer/refund-requests')
@UseGuards(CustomerAuthGuard)
export class CustomerRefundRequestsController {
  constructor(
    private readonly submissions: RefundSubmissionService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  /** Submit a confirmed claim. Status: 201 new, 200 replay of the same key, 202 still processing. */
  @Post()
  @SubmitRateLimit()
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'One UUID per confirmation card; reuse it when retrying.' })
  @ApiCreatedResponse({ type: CustomerRequestViewDto })
  @ApiOkResponse({ type: CustomerRequestViewDto, description: 'Replay of an earlier submission with the same key' })
  @ApiAcceptedResponse({ type: CustomerRequestViewDto, description: 'Accepted, still processing' })
  @ApiConflictResponse({ description: 'IDEMPOTENCY_KEY_REUSED or ALREADY_IN_PROGRESS' })
  @ApiUnprocessableEntityResponse({ description: 'NOTHING_LEFT_TO_REFUND or QUANTITY_TOO_HIGH' })
  @ApiNotFoundResponse({ description: 'ORDER_OR_ITEM_NOT_FOUND' })
  async submit(
    @CurrentCustomerId() customerId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: SubmitRefundRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CustomerRequestViewDto> {
    const { kind, view } = await this.submissions.submit(customerId, idempotencyKey, body);
    res.status(view.status === 'PROCESSING' ? HttpStatus.ACCEPTED : kind === 'created' ? HttpStatus.CREATED : HttpStatus.OK);
    return view;
  }

  @Get()
  @ApiOkResponse({ type: [CustomerRequestViewDto] })
  list(@CurrentCustomerId() customerId: string): Promise<CustomerRequestViewDto[]> {
    return listCustomerRequests(this.db, customerId);
  }

  @Get(':requestId')
  @ApiOkResponse({ type: CustomerRequestViewDto })
  @ApiNotFoundResponse()
  async get(@CurrentCustomerId() customerId: string, @Param('requestId') requestId: string): Promise<CustomerRequestViewDto> {
    const view = PUBLIC_ID.test(requestId) ? await loadCustomerRequestView(this.db, customerId, { publicId: requestId }) : null;
    if (!view) throw new NotFoundException('Request not found.');
    return view;
  }
}
