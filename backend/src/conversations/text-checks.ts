import { MAX_REPLY_CHARS } from './assistant-turn.js';

const MONEY = /[$€£¥₦]|\b\d+(?:[.,]\d{1,2})?\s*(?:usd|eur|gbp|ngn|dollars?|euros?|pounds?|naira)\b/i;
const OUTCOME = /\b(?:approv\w*|guarantee\w*|eligib\w*|deny|denied|reject\w*|will be refunded|refund will|you will (?:get|receive))\b/i;
const CONTACT = /https?:\/\/|\bwww\.|\b[\w.+-]+@[\w-]+\.[\w.-]+\b|\+?\d[\d\s().-]{7,}\d/i;
const INTERNAL = /\b(?:policy engine|rules?|flag(?:ged|s)?|fraud|escalat\w*|threshold|confidence|system prompt)\b/i;

const INJECTION = [
  /\b(?:ignore|disregard|forget)\b.{0,30}\b(?:previous|prior|above|earlier|your|all)\b.{0,20}\b(?:instructions?|rules|prompts?|messages)\b/i,
  /\b(?:system|developer|assistant)\s*:/i,
  /<\/?\s*(?:system|assistant|user|instructions?|conversation|orders)\s*>/i,
  /\byou are now\b/i,
  /\bnew instructions?\b/i,
  /\b(?:developer|admin|god|jailbreak)\s+mode\b/i,
  /\bapprove\b.{0,20}\b(?:this|my|the)\b.{0,20}\b(?:refund|request|claim)\b/i,
  /\bpretend (?:to be|you are)\b/i,
];

const ORDER_NUMBER = /\bWN-[A-Z0-9]{6}\b/gi;
// Control characters other than tab and newline.
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Strips control characters and surrounding whitespace from customer input. */
export function sanitizeText(text: string): string {
  return text.replace(CONTROL, '').trim();
}

/** True when an assistant reply may be shown before a decision exists. */
export function isSafeTurnReply(reply: string): boolean {
  return reply.length > 0 && reply.length <= MAX_REPLY_CHARS && ![MONEY, OUTCOME, CONTACT, INTERNAL].some((pattern) => pattern.test(reply));
}

export function looksLikeInjection(text: string): boolean {
  return INJECTION.some((pattern) => pattern.test(text));
}

/** Order numbers mentioned in the text that are not among the customer's own. */
export function foreignOrderNumbers(text: string, ownOrderNumbers: readonly string[]): string[] {
  const own = new Set(ownOrderNumbers.map((n) => n.toUpperCase()));
  return [...new Set((text.match(ORDER_NUMBER) ?? []).map((n) => n.toUpperCase()))].filter((n) => !own.has(n));
}

/** Lower-cased with whitespace collapsed, for verbatim evidence comparison. */
export function normalizeForEvidence(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}
