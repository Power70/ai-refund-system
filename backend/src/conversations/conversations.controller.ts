import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { ChatRateLimit } from '../common/rate-limit/rate-limit.decorators.js';
import { CurrentCustomerId } from '../customer-auth/current-customer-id.decorator.js';
import { CustomerAuthGuard } from '../customer-auth/customer-auth.guard.js';
import { SESSION_COOKIE } from '../customer-auth/session-cookie.js';
import { ConversationService } from './conversation.service.js';
import { ConversationViewDto, SendMessageDto } from './conversations.dto.js';

const notFound = () => new NotFoundException('Conversation not found.');

@ApiTags('customer conversations')
@ApiCookieAuth(SESSION_COOKIE)
@Controller('customer/conversations')
@UseGuards(CustomerAuthGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationService) {}

  @Post()
  @ApiCreatedResponse({ type: ConversationViewDto })
  @ApiTooManyRequestsResponse({ description: 'CONVERSATION_LIMIT: 10 per customer per day' })
  start(@CurrentCustomerId() customerId: string): Promise<ConversationViewDto> {
    return this.conversations.start(customerId);
  }

  @Get(':conversationId')
  @ApiOkResponse({ type: ConversationViewDto })
  @ApiNotFoundResponse()
  async get(
    @CurrentCustomerId() customerId: string,
    @Param('conversationId', new ParseUUIDPipe({ exceptionFactory: notFound })) conversationId: string,
  ): Promise<ConversationViewDto> {
    const view = await this.conversations.view(customerId, conversationId);
    if (!view) throw notFound();
    return view;
  }

  @Post(':conversationId/messages')
  @HttpCode(200)
  @ChatRateLimit()
  @ApiOkResponse({ type: ConversationViewDto, description: 'The conversation including the reply' })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'MESSAGE_IN_PROGRESS or CONVERSATION_CLOSED' })
  send(
    @CurrentCustomerId() customerId: string,
    @Param('conversationId', new ParseUUIDPipe({ exceptionFactory: notFound })) conversationId: string,
    @Body() body: SendMessageDto,
  ): Promise<ConversationViewDto> {
    return this.conversations.send(customerId, conversationId, body);
  }
}
