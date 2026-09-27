import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    // Stored lower-cased so lookups and uniqueness are case-insensitive.
    email: text('email').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('customers_email_lowercase', sql`${t.email} = lower(${t.email})`)],
);
