import { ApiProperty } from '@nestjs/swagger';

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
    aiProposal: unknown;
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
  @ApiProperty() audit: { type: string; actor: string; data: unknown; at: string }[];
}
