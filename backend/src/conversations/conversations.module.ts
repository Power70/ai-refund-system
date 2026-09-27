import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module.js';
import { ConversationService } from './conversation.service.js';
import { ConversationsController } from './conversations.controller.js';

@Module({
  imports: [CustomerAuthModule],
  controllers: [ConversationsController],
  providers: [ConversationService],
})
export class ConversationsModule {}
