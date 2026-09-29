import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, IsBoolean, IsUUID, ArrayMaxSize, ArrayMinSize, MinLength, ValidateNested } from 'class-validator';
import { ArrayUniqueBy } from '../../common/validation.js';
import { AiStatusDto } from '../../health/dto/health.dto.js';

export const QUEUE_VIEWS = ['needs-review', 'all'] as const;
export const QUEUE_STATUSES = ['PROCESSING', 'APPROVED', 'DENIED', 'ESCALATED'] as const;

export class AdminQueueQueryDto {
  @ApiPropertyOptional({ enum: QUEUE_VIEWS, default: 'all', description: 'needs-review: unresolved escalations, oldest first' })
  @IsOptional()
  @IsIn(QUEUE_VIEWS)
  view: (typeof QUEUE_VIEWS)[number] = 'all';

  @ApiPropertyOptional({ enum: QUEUE_STATUSES, description: 'Automated decision status' })
  @IsOptional()
  @IsIn(QUEUE_STATUSES)
  status?: (typeof QUEUE_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Request id, order number, customer name or email' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 10;
}

export class AdminQueueRowDto {
  @ApiProperty({ example: 'rr_7k3p9qa2mx4d' }) requestId: string;
  @ApiProperty() createdAt: string;
  @ApiProperty({ enum: ['CUSTOMER', 'SEED'], description: 'SEED = demo history loaded at startup' }) source: string;
  @ApiProperty() customerName: string;
  @ApiProperty() customerEmail: string;
  @ApiProperty() orderNumber: string;
  @ApiProperty() reason: string;
  @ApiProperty({ description: 'Cents' }) requestedAmountMinor: number;
  @ApiProperty({ enum: ['PROCESSING', 'APPROVED', 'DENIED', 'ESCALATED'] }) status: string;
  @ApiProperty({ description: 'Cents' }) approvedAmountMinor: number;
  @ApiProperty({ type: [String], description: 'Why it went to a person (escalations) or which rules decided it' }) reasons: string[];
  @ApiProperty({ nullable: true, enum: ['APPROVED', 'PARTIALLY_APPROVED', 'DENIED'] }) resolution: string | null;
}

export class AdminQueueDto {
  @ApiProperty({ type: [AdminQueueRowDto] }) items: AdminQueueRowDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
}

/** Everything a reviewer needs to decide an escalation. Customer text is data: render as plain text. */
export class CaseBriefDto {
  @ApiProperty() request: {
    requestId: string;
    source: string;
    state: string;
    createdAt: string;
    attempts: number;
    reasonConfirmed: string;
    reasonOverridden: boolean;
  };
  @ApiProperty() customer: { name: string; email: string };
  @ApiProperty() order: { orderNumber: string; placedAt: string; deliveredAt: string | null; currency: string };
  @ApiProperty() lines: {
    lineId: string;
    itemName: string;
    sku: string;
    finalSale: boolean;
    quantity: number;
    amountMinor: number;
    lineOutcome: string | null;
    decidingRuleId: string | null;
    publicReason: string | null;
    finalLineStatus: string | null;
  }[];
  @ApiProperty({ nullable: true }) decision: {
    status: string;
    approvedAmountMinor: number;
    escalationReasons: string[];
    customerMessage: string;
    messageSource: string;
    policyVersion: string;
    gateResult: unknown;
    ruleTrace: unknown;
    decidedAt: string;
  } | null;
  @ApiProperty({ nullable: true }) resolution: {
    outcome: string;
    approvedAmountMinor: number;
    reviewerNote: string;
    customerMessage: string;
    lines: { lineId: string; itemName: string; approve: boolean }[];
    resolvedAt: string;
  } | null;
  @ApiProperty({ nullable: true, description: 'The chat the claim came from; null for claims made without chat' }) conversation: {
    conversationId: string;
    mode: string;
    handoverReason: string | null;
    flags: { injectionAttempt: boolean; mentionsOtherCustomerOrder: boolean; abusive: boolean; offTopic: boolean };
    priorFlaggedConversation: boolean;
    transcript: { role: string; text: string; typed: boolean; at: string }[];
    /** Customer quotes the AI cited; highlight them in the transcript. */
    evidenceQuotes: string[];
  } | null;
  @ApiProperty({ description: 'What the AI proposed next to what the customer confirmed' }) claim: {
    proposed: { reason: string; confidence: number; lines: { itemName: string; quantity: number }[] } | null;
    confirmed: { reason: string; lines: { itemName: string; quantity: number }[] };
    reasonOverridden: boolean;
    itemsNotDiscussed: string[];
  };
  @ApiProperty({ nullable: true, description: 'AI suggestion; advisory only. Null when not generated or suppressed.' }) aiSummary: {
    summary: string;
    suggestedAction: 'APPROVE' | 'DENY' | 'NEEDS_INFO';
    rationale: string;
  } | null;
  @ApiProperty({ description: 'True when the summary was withheld because injection was flagged' }) aiSummarySuppressed: boolean;
  @ApiProperty() aiCalls: { kind: string; provider: string | null; model: string | null; outcome: string; attempts: number; latencyMs: number; inputTokens: number | null; outputTokens: number | null; at: string }[];
  @ApiProperty({ description: 'correlationId: the API request (or sweeper pass) that wrote the event' }) audit: { type: string; actor: string; data: unknown; correlationId: string | null; at: string }[];
}

export class RequestCountsDto {
  @ApiProperty() total: number;
  @ApiProperty() last24Hours: number;
  @ApiProperty({ description: 'Not yet decided' }) processing: number;
  @ApiProperty({ description: 'Automated decision' }) approved: number;
  @ApiProperty({ description: 'Automated decision' }) denied: number;
  @ApiProperty({ description: 'Automated decision' }) escalated: number;
  @ApiProperty({ description: 'Escalations without a resolution' }) awaitingReview: number;
}

export class ResolutionCountsDto {
  @ApiProperty() approved: number;
  @ApiProperty() partiallyApproved: number;
  @ApiProperty() denied: number;
}

export class EscalationReasonCountDto {
  @ApiProperty({ example: 'HIGH_VALUE' }) reason: string;
  @ApiProperty() count: number;
}

export class AdminMetricsDto {
  @ApiProperty() generatedAt: string;
  @ApiProperty({ type: RequestCountsDto }) requests: RequestCountsDto;
  @ApiProperty({ type: ResolutionCountsDto }) resolutions: ResolutionCountsDto;
  @ApiProperty({ type: [EscalationReasonCountDto], description: 'Top 10, most frequent first' }) topEscalationReasons: EscalationReasonCountDto[];
  @ApiProperty({ description: 'Expected to be 0' }) stuckProcessingCount: number;
  @ApiProperty({ type: AiStatusDto }) ai: AiStatusDto;
}

export class LineDecisionDto {
  @ApiProperty({ format: 'uuid', description: 'lineId from the case brief' })
  @IsUUID()
  lineId: string;

  @ApiProperty({ description: 'true refunds this line; false does not' })
  @IsBoolean()
  approve: boolean;
}

/** A reviewer's decision: yes or no for every line, plus a note. Amounts are never accepted. */
export class ResolveEscalationDto {
  @ApiProperty({ type: [LineDecisionDto], description: 'Exactly one decision for every line of the request' })
  @ValidateNested({ each: true })
  @Type(() => LineDecisionDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUniqueBy('lineId', { message: 'each line may appear only once' })
  lineDecisions: LineDecisionDto[];

  @ApiProperty({ minLength: 3, maxLength: 1000, description: 'Internal note explaining the decision (not shown to the customer)' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reviewerNote: string;
}
