# AI Refund Support

AI-powered customer support for e-commerce refund requests: customers describe their problem in a chat, the AI identifies the order and reason, the customer confirms, a versioned refund policy decides (Approved / Denied / Escalated), and support staff review escalations on a dashboard.

> **Status:** under active development. The full README (architecture, AI design, policy, trade-offs) is completed at the end of the build. The design plan is in [`plans/`](plans/).

## Quick start

Requirements: Docker with Compose.

```bash
docker-compose up --build
```

Then open <http://localhost:8080>. API docs: <http://localhost:8080/docs>.

No `.env` file is needed; to override defaults, copy `.env.example` to `.env`.

Smoke test a running stack (Git Bash or WSL on Windows):

```bash
./scripts/smoke.sh
```

## Local development (without Docker)

```bash
# API on :3000
cd backend && npm install && npm run start:dev
# Frontend on :5173 (proxies /api and /docs to :3000)
cd frontend && npm install && npm run dev
```

The API needs PostgreSQL. Set `DATABASE_URL` (e.g. `postgresql://refund:refund_demo_password@localhost:5432/refund_support`) and run `npm run db:migrate` in `backend/` before `npm run start:dev`.

Tests (in `backend/`):

```bash
npm test            # unit tests, no database needed
npm run test:e2e    # needs PostgreSQL; each suite creates and drops its own database
```

End-to-end tests connect to `postgresql://refund:refund_demo_password@127.0.0.1:5432/postgres` by default; override with `TEST_DATABASE_ADMIN_URL` (the user must be allowed to create databases). A quick throwaway server:

```bash
docker run --rm -d -p 5432:5432 -e POSTGRES_USER=refund -e POSTGRES_PASSWORD=refund_demo_password postgres:16-alpine
```

Database changes: edit `backend/src/database/schema.ts`, then `npm run db:generate` writes a new SQL migration to `backend/drizzle/`.
