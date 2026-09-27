import type { ConversationFlags } from '../database/schema/conversations.table.js';
import { REASON_LABELS, type RefundReason } from '../policy/refund-reasons.js';
import type { AssistantTurn, ChatContext, ContextItem, ContextOrder } from './assistant-turn.js';
import { foreignOrderNumbers, isSafeTurnReply, looksLikeInjection, normalizeForEvidence } from './text-checks.js';

export type QuickReply =
  | { kind: 'ITEM'; orderItemId: string; label: string }
  | { kind: 'REASON'; reason: RefundReason; label: string }
  | { kind: 'YES_NO'; value: boolean; label: string };

export interface ProposalLine {
  orderItemId: string;
  itemName: string;
  quantity: number;
  maxQuantity: number;
}

/** A verified claim proposal, as shown on the confirmation card. */
export interface ProposalView {
  orderId: string;
  orderNumber: string;
  reason: RefundReason;
  lines: ProposalLine[];
}

/** Stored with the conversation; evidence and confidence are never sent to the customer. */
export interface ProposalRecord extends ProposalView {
  evidenceQuotes: string[];
  confidence: number;
}

export type ProposalRejection = 'UNKNOWN_REF' | 'NOTHING_REFUNDABLE' | 'QUANTITY_TOO_HIGH' | 'EVIDENCE_NOT_FOUND' | 'DUPLICATE_ITEM';

export interface VerifiedTurn {
  reply: string;
  replySource: 'AI' | 'TEMPLATE';
  quickReplies: QuickReply[];
  proposal: ProposalRecord | null;
  proposalRejection: ProposalRejection | null;
  flags: ConversationFlags;
  discussedItemIds: string[];
  summary: string;
}

export const TEMPLATES = {
  clarify: 'Could you tell me which item this is about and what happened with it?',
  evidence: 'Could you describe in your own words what went wrong with the item?',
  unsafeReply: 'Thanks. Could you tell me a bit more about the item and what happened?',
};

/**
 * Checks an AI turn against the customer's own orders and messages. Anything unverifiable is
 * dropped or replaced by a template; flags combine the model's with code heuristics.
 */
export function verifyTurn(turn: AssistantTurn, context: ChatContext, typedCustomerMessages: readonly string[]): VerifiedTurn {
  const itemsByRef = new Map(context.orders.flatMap((order) => order.items.map((item) => [item.ref, { order, item }] as const)));
  const ordersByRef = new Map(context.orders.map((order) => [order.ref, order]));

  const quickReplies = turn.quickReplies.flatMap((chip): QuickReply[] => {
    if (chip.kind === 'ITEM') {
      const found = itemsByRef.get(chip.itemRef);
      return found ? [{ kind: 'ITEM', orderItemId: found.item.orderItemId, label: found.item.name }] : [];
    }
    if (chip.kind === 'REASON') return [{ kind: 'REASON', reason: chip.reason, label: REASON_LABELS[chip.reason] }];
    return [{ kind: 'YES_NO', value: chip.value, label: chip.value ? 'Yes' : 'No' }];
  });

  const checked = turn.proposal ? checkProposal(turn.proposal, ordersByRef, typedCustomerMessages) : { proposal: null, rejection: null, reply: null };

  const latest = typedCustomerMessages.at(-1) ?? '';
  const ownNumbers = context.orders.map((o) => o.orderNumber);
  const flags: ConversationFlags = {
    injectionAttempt: turn.flags.injectionAttempt || looksLikeInjection(latest),
    mentionsOtherCustomerOrder: turn.flags.mentionsOtherCustomerOrder || foreignOrderNumbers(latest, ownNumbers).length > 0,
    abusive: turn.flags.abusive,
    offTopic: turn.flags.offTopic,
  };

  const reply = checked.reply ?? (isSafeTurnReply(turn.reply) ? turn.reply : TEMPLATES.unsafeReply);
  return {
    reply,
    replySource: reply === turn.reply ? 'AI' : 'TEMPLATE',
    quickReplies: checked.reply ? [] : quickReplies,
    proposal: checked.proposal,
    proposalRejection: checked.rejection,
    flags,
    discussedItemIds: [...new Set([
      ...(checked.proposal?.lines.map((l) => l.orderItemId) ?? []),
      ...quickReplies.flatMap((q) => (q.kind === 'ITEM' ? [q.orderItemId] : [])),
    ])],
    summary: turn.summary,
  };
}

type CheckedProposal =
  | { proposal: ProposalRecord; rejection: null; reply: null }
  | { proposal: null; rejection: ProposalRejection; reply: string };

function checkProposal(
  proposal: NonNullable<AssistantTurn['proposal']>,
  ordersByRef: Map<string, ContextOrder>,
  typedCustomerMessages: readonly string[],
): CheckedProposal {
  const reject = (rejection: ProposalRejection, reply: string): CheckedProposal => ({ proposal: null, rejection, reply });

  const order = ordersByRef.get(proposal.orderRef);
  if (!order) return reject('UNKNOWN_REF', TEMPLATES.clarify);
  if (new Set(proposal.lines.map((l) => l.itemRef)).size !== proposal.lines.length) return reject('DUPLICATE_ITEM', TEMPLATES.clarify);

  const lines: ProposalLine[] = [];
  for (const line of proposal.lines) {
    const item = order.items.find((i) => i.ref === line.itemRef);
    if (!item) return reject('UNKNOWN_REF', TEMPLATES.clarify);
    if (item.refundable === 0) return reject('NOTHING_REFUNDABLE', nothingRefundableMessage(item));
    if (line.quantity > item.refundable) {
      return reject('QUANTITY_TOO_HIGH', `You can claim up to ${item.refundable} of "${item.name}". How many would you like to return?`);
    }
    lines.push({ orderItemId: item.orderItemId, itemName: item.name, quantity: line.quantity, maxQuantity: item.refundable });
  }

  const typed = typedCustomerMessages.map(normalizeForEvidence);
  const grounded = proposal.evidenceQuotes.every((quote) => {
    const needle = normalizeForEvidence(quote);
    return needle.length > 0 && typed.some((message) => message.includes(needle));
  });
  if (!grounded) return reject('EVIDENCE_NOT_FOUND', TEMPLATES.evidence);

  return {
    proposal: {
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      reason: proposal.reason,
      lines,
      evidenceQuotes: proposal.evidenceQuotes,
      confidence: proposal.confidence,
    },
    rejection: null,
    reply: null,
  };
}

function nothingRefundableMessage(item: ContextItem): string {
  return item.pending > 0
    ? `"${item.name}" already has a request in progress, so it can't be claimed again right now.`
    : `"${item.name}" has already been refunded in full.`;
}
