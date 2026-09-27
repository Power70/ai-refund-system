/**
 * Rate-limit key for signed-in routes: the customer id read from the session cookie
 * WITHOUT verifying it. That is safe for counting: a forged cookie only lands in its own
 * bucket and is then rejected by CustomerAuthGuard; a real customer is always counted as themselves.
 */
export function customerTracker(req: Record<string, any>): string {
  const token = (req.cookies as Record<string, string> | undefined)?.rs_session;
  const body = typeof token === 'string' ? token.split('.')[0] : undefined;
  if (body) {
    try {
      const sub = (JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { sub?: unknown }).sub;
      if (typeof sub === 'string' && sub.length <= 64) return `customer:${sub}`;
    } catch {
      // fall through to the IP
    }
  }
  return `ip:${String(req.ip)}`;
}
