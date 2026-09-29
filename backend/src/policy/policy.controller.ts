import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard.js';
import { ActivePolicyDto } from './dto/policy.dto.js';
import { renderPolicyMarkdown } from './policy-docs.js';
import { PolicyService } from './policy.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or wrong admin token' })
@Controller('admin/policy')
@UseGuards(AdminAuthGuard)
export class PolicyController {
  constructor(private readonly policies: PolicyService) {}

  @Get()
  @ApiOkResponse({ type: ActivePolicyDto })
  async active(): Promise<ActivePolicyDto> {
    const policy = await this.policies.activePolicy();
    return {
      version: policy.version,
      effectiveFrom: policy.effectiveFrom.toISOString(),
      contentHash: policy.contentHash,
      markdown: renderPolicyMarkdown(policy.document),
      document: policy.document,
    };
  }
}
