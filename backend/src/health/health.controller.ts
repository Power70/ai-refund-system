import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthResponseDto } from './dto/health.dto.js';
import { HealthService } from './health.service.js';

/** Public liveness check: ok/degraded only. Details are at GET /admin/health. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto, description: 'Database unreachable' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponseDto> {
    if (await this.health.isDatabaseReachable()) return { status: 'ok' };
    res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: 'degraded' };
  }
}
