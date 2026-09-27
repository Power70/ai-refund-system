import { randomBytes } from 'node:crypto';
import pg from 'pg';

/** Server used for tests. Override with TEST_DATABASE_ADMIN_URL (must be allowed to CREATE DATABASE). */
const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://refund:refund_demo_password@127.0.0.1:5432/postgres';

export interface TestDatabase {
  url: string;
  drop: () => Promise<void>;
}

/** Creates an empty, uniquely named database so each test file is fully isolated. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `refund_test_${randomBytes(6).toString('hex')}`;
  await withAdmin((client) => client.query(`CREATE DATABASE "${name}"`));
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: () => withAdmin((client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)).then(() => undefined),
  };
}

async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
