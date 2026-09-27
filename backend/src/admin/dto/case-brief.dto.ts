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
  @ApiProperty() audit: { type: string; actor: string; data: unknown; at: string }[];
}
