import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

export const LEASE_MS = 60_000;

/** A unique owner id per processing attempt, and when the lease runs out. */
export function newLease(now = new Date()): { leaseOwner: string; leaseExpiresAt: Date } {
  return { leaseOwner: `${hostname()}:${process.pid}:${randomUUID()}`, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) };
}
