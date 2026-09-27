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

Tests: `cd backend && npm test && npm run test:e2e`.
