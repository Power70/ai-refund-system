import { defineConfig } from 'drizzle-kit';
// Used only by `npm run db:generate` (development) to write SQL migrations from the schema.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
