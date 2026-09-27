import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DatabaseHealthService } from '../database/database-health.service.js';
import { HealthResponseDto } from './health-response.dto.js';

/**
 * Public liveness/readiness endpoint. Reports only ok/degraded, never internal details;
 * the detailed status lives behind admin auth (added in a later bit).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseHealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto, description: 'Database unreachable' })
  async getHealth(@Res({ passthrough: true }) res: Response): Promise<HealthResponseDto> {
    if (await this.database.isReachable()) return { status: 'ok' };
    res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: 'degraded' };
  }
}
