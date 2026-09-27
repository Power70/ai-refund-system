import { Module } from '@nestjs/common';
import { AiStatusService } from './ai-status.service.js';

@Module({
  providers: [AiStatusService],
  exports: [AiStatusService],
})
export class AiStatusModule {}
