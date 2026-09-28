import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentCustomerId } from '../auth/decorators/current-customer.decorator.js';
import { CustomerAuthGuard } from '../auth/guards/customer-auth.guard.js';
import { SESSION_COOKIE } from '../auth/session-token.js';
import { ChatRateLimit } from '../common/rate-limit.js';
import { ConversationsService } from './conversations.service.js';
import { ConversationViewDto, SendMessageDto } from './dto/conversations.dto.js';

const notFound = () => new NotFoundException('Conversation not found.');
const conversationIdPipe = new ParseUUIDPipe({ exceptionFactory: notFound });

@ApiTags('customer conversations')
@ApiCookieAuth(SESSION_COOKIE)
@ApiUnauthorizedResponse()
@Controller('customer/conversations')
@UseGuards(CustomerAuthGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

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
    @Param('conversationId', conversationIdPipe) conversationId: string,
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
    @Param('conversationId', conversationIdPipe) conversationId: string,
    @Body() body: SendMessageDto,
  ): Promise<ConversationViewDto> {
    return this.conversations.send(customerId, conversationId, body);
  }
}
