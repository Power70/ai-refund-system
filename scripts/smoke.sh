#!/usr/bin/env bash
# Smoke test for a running stack: `docker-compose up -d && ./scripts/smoke.sh`
# (On Windows, run from Git Bash or WSL.)
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:${WEB_PORT:-8080}}"
fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }

echo "Waiting for ${BASE_URL}/api/v1/health ..."
for attempt in $(seq 1 60); do
  if body=$(curl -fsS "${BASE_URL}/api/v1/health" 2>/dev/null) && [ "$body" = '{"status":"ok"}' ]; then
    break
  fi
  [ "$attempt" -eq 60 ] && fail "API did not become healthy (last response: ${body:-none})"
  sleep 2
done
echo "ok  API health through the web proxy"

curl -fsS "${BASE_URL}/" | grep -q '<div id="root">' || fail "frontend index.html not served"
echo "ok  frontend served"

headers=$(curl -fsSI "${BASE_URL}/")
echo "$headers" | grep -qi "^content-security-policy:" || fail "missing Content-Security-Policy on frontend"
echo "$headers" | grep -qi "^x-content-type-options: nosniff" || fail "missing X-Content-Type-Options on frontend"
echo "ok  frontend security headers"

[ "$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/docs")" = "200" ] || fail "Swagger UI not reachable at /docs"
echo "ok  API docs at /docs"

[ "$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/some/client/route")" = "200" ] || fail "SPA fallback routing broken"
echo "ok  SPA fallback routing"

echo "Smoke test passed."
