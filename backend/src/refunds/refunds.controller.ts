import { Body, Controller, Get, Headers, HttpStatus, NotFoundException, Param, Post, Res, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentCustomerId } from '../auth/decorators/current-customer.decorator.js';
import { CustomerAuthGuard } from '../auth/guards/customer-auth.guard.js';
import { SESSION_COOKIE } from '../auth/session-token.js';
import { SubmitRateLimit } from '../common/rate-limit.js';
import { ParsePublicRequestIdPipe } from '../common/validation.js';
import { CustomerRequestViewDto, SubmitRefundRequestDto } from './dto/refunds.dto.js';
import { RefundsService } from './refunds.service.js';

@ApiTags('customer refund requests')
@ApiCookieAuth(SESSION_COOKIE)
@ApiUnauthorizedResponse()
@Controller('customer/refund-requests')
@UseGuards(CustomerAuthGuard)
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  /** 201 new, 200 replay of the same key, 202 still processing. */
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
    const { kind, view } = await this.refunds.submit(customerId, idempotencyKey, body);
    res.status(view.status === 'PROCESSING' ? HttpStatus.ACCEPTED : kind === 'created' ? HttpStatus.CREATED : HttpStatus.OK);
    return view;
  }

  @Get()
  @ApiOkResponse({ type: [CustomerRequestViewDto] })
  list(@CurrentCustomerId() customerId: string): Promise<CustomerRequestViewDto[]> {
    return this.refunds.list(customerId);
  }

  @Get(':requestId')
  @ApiOkResponse({ type: CustomerRequestViewDto })
  @ApiNotFoundResponse()
  async get(@CurrentCustomerId() customerId: string, @Param('requestId', ParsePublicRequestIdPipe) requestId: string): Promise<CustomerRequestViewDto> {
    const view = await this.refunds.view(customerId, { publicId: requestId });
    if (!view) throw new NotFoundException('Request not found.');
    return view;
  }
}
