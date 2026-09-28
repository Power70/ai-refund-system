#!/usr/bin/env bash
# End-to-end smoke test for a running stack, through the web proxy exactly as a browser uses it.
#
#   docker-compose down -v && docker-compose up -d --build && ./scripts/smoke.sh
#
# Run it against a fresh stack: it submits claims for seeded customers, and earlier claims made
# through the UI change what those customers can still claim. Re-running it on the same stack is
# safe: each claim uses a fixed Idempotency-Key, so repeats replay the stored result. Wait a
# minute between runs, or the per-customer submission limit (5 per minute) answers 429.
# Needs bash and curl only (on Windows: Git Bash or WSL).
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:${WEB_PORT:-8080}}"
API="${BASE_URL}/api/v1"
ADMIN_TOKEN="${ADMIN_TOKEN:-admin-demo-token}"
CSRF=(-H 'X-Requested-With: refund-app')
JSON=(-H 'Content-Type: application/json')
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
pass() { echo "ok  $*"; }

# First string value of a JSON field in the given text (enough for these flat checks).
field() { printf '%s' "$2" | grep -o "\"$1\":\"[^\"]*\"" | head -1 | sed -E "s/\"$1\":\"(.*)\"/\1/"; }

# Status code of a request; the body is written to $WORKDIR/body.
call() { curl -sS -o "$WORKDIR/body" -w '%{http_code}' "$@"; }
body() { cat "$WORKDIR/body"; }

expect_status() {
  local expected="$1" label="$2"; shift 2
  local status; status=$(call "$@")
  [ "$status" = "$expected" ] || fail "$label: expected HTTP $expected, got $status: $(body)"
}

sign_in() {
  local jar="$WORKDIR/$1.jar"
  expect_status 200 "sign in as $1" -c "$jar" "${CSRF[@]}" "${JSON[@]}" -d "{\"email\":\"$1\",\"orderNumber\":\"$2\"}" "$API/customer/session"
  echo "$jar"
}

# The id of the signed-in customer's item with this exact name.
item_id() {
  local orders; orders=$(curl -fsS -b "$1" "$API/customer/orders")
  local id; id=$(printf '%s' "$orders" | grep -oE "\"id\":\"[0-9a-f-]{36}\",\"name\":\"$2\"" | head -1 | grep -oE '[0-9a-f-]{36}')
  [ -n "$id" ] || fail "item \"$2\" not found in the customer's orders"
  echo "$id"
}

# Submits a confirmed one-item claim; prints the response body. A replay of the same key answers 200.
submit() {
  local jar="$1" key="$2" order="$3" item="$4" reason="$5"
  local status; status=$(call -b "$jar" "${CSRF[@]}" "${JSON[@]}" -H "Idempotency-Key: $key" \
    -d "{\"orderNumber\":\"$order\",\"reason\":\"$reason\",\"lines\":[{\"itemId\":\"$item\",\"quantity\":1}]}" "$API/customer/refund-requests")
  case "$status" in 200|201) body ;; *) fail "submit $key: HTTP $status: $(body)" ;; esac
}

admin_brief() { curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" "$API/admin/refund-requests/$1"; }

# --- Stack is up ---------------------------------------------------------------------------

echo "Waiting for ${API}/health ..."
for attempt in $(seq 1 90); do
  if health=$(curl -fsS "${API}/health" 2>/dev/null); then break; fi
  [ "$attempt" -eq 90 ] && fail "API did not become healthy"
  sleep 2
done
[ "$health" = '{"status":"ok"}' ] || fail "public /health must expose only its status, got: $health"
pass "API healthy; public /health exposes nothing internal"

curl -fsS "${BASE_URL}/" | grep -q '<div id="root">' || fail "frontend index.html not served"
headers=$(curl -fsSI "${BASE_URL}/")
printf '%s' "$headers" | grep -qi '^content-security-policy:' || fail "missing Content-Security-Policy"
printf '%s' "$headers" | grep -qi '^x-content-type-options: nosniff' || fail "missing X-Content-Type-Options"
[ "$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/some/client/route")" = "200" ] || fail "SPA fallback routing broken"
pass "frontend served with security headers and SPA fallback"

[ "$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/docs")" = "200" ] || fail "Swagger UI not reachable at /docs"
pass "API docs at /docs"

# --- Access control ------------------------------------------------------------------------

expect_status 401 "admin API without a token" "$API/admin/metrics"
expect_status 200 "admin health with the token" -H "Authorization: Bearer $ADMIN_TOKEN" "$API/admin/health"
admin_health=$(body)
[ "$(field database "$admin_health")" = "ok" ] || fail "admin health reports the database as unreachable: $admin_health"
[ "$(field policyVersion "$admin_health")" != "" ] || fail "no refund policy in force: $admin_health"
pass "admin API needs the token; database up, policy $(field policyVersion "$admin_health") in force, AI $(printf '%s' "$admin_health" | grep -o '"ai":{"status":"[a-z]*"' | sed -E 's/.*"([a-z]+)"$/\1/')"

expect_status 403 "state change without the CSRF header" "${JSON[@]}" -d '{}' "$API/customer/session"
expect_status 404 "sign in with the wrong order number" "${CSRF[@]}" "${JSON[@]}" -d '{"email":"ben.carter@example.com","orderNumber":"WN-000000"}' "$API/customer/session"
pass "CSRF header required; wrong sign-in details get a plain 404"

# --- Seeded scenarios, submitted as confirmed claims ---------------------------------------

ben=$(sign_in ben.carter@example.com WN-Q4M1ZT)
lamp=$(item_id "$ben" 'Desk lamp, black')
denied=$(submit "$ben" smoke-scenario-02 WN-Q4M1ZT "$lamp" DAMAGED)
[ "$(field status "$denied")" = "DENIED" ] || fail "#2 (45 days after delivery) should be DENIED: $denied"
pass "#2 damaged item after 45 days: DENIED"

replay_status=$(call -b "$ben" "${CSRF[@]}" "${JSON[@]}" -H 'Idempotency-Key: smoke-scenario-02' \
  -d "{\"orderNumber\":\"WN-Q4M1ZT\",\"reason\":\"DAMAGED\",\"lines\":[{\"itemId\":\"$lamp\",\"quantity\":1}]}" "$API/customer/refund-requests")
if [ "$replay_status" != "200" ] || [ "$(field requestId "$(body)")" != "$(field requestId "$denied")" ]; then
  fail "same key and claim should replay the original request (HTTP $replay_status)"
fi
expect_status 409 "same key, different claim" -b "$ben" "${CSRF[@]}" "${JSON[@]}" -H 'Idempotency-Key: smoke-scenario-02' \
  -d "{\"orderNumber\":\"WN-Q4M1ZT\",\"reason\":\"WRONG_ITEM\",\"lines\":[{\"itemId\":\"$lamp\",\"quantity\":1}]}" "$API/customer/refund-requests"
pass "idempotency: a retry replays the original request; a changed claim under the same key is refused"

efe=$(sign_in efe.adebayo@example.com WN-L6W9PH)
laptop=$(item_id "$efe" 'Laptop 14\\", 512 GB')
high=$(submit "$efe" smoke-scenario-05 WN-L6W9PH "$laptop" WRONG_ITEM)
[ "$(field status "$high")" = "ESCALATED" ] || fail "#5 (\$749) should be ESCALATED: $high"
admin_brief "$(field requestId "$high")" | grep -q '"HIGH_VALUE"' || fail "#5 should be escalated by HIGH_VALUE"
pass "#5 \$749 wrong item: ESCALATED (HIGH_VALUE)"

ada=$(sign_in ada.okafor@example.com WN-7K3P9Q)
shirt=$(item_id "$ada" 'Oxford shirt, blue')
manual=$(submit "$ada" smoke-scenario-01 WN-7K3P9Q "$shirt" DAMAGED)
[ "$(field status "$manual")" = "ESCALATED" ] || fail "#1 as a claim without chat should be ESCALATED: $manual"
brief=$(admin_brief "$(field requestId "$manual")")
printf '%s' "$brief" | grep -q '"policyStatus":"APPROVED"' || fail "#1 should pass the policy"
printf '%s' "$brief" | grep -q '"NO_AI_ASSESSMENT"' || fail "#1 without chat should be held by the safety gate (NO_AI_ASSESSMENT)"
pass "#1 without the chat: policy approves, the safety gate holds it for a person (NO_AI_ASSESSMENT)"

expect_status 404 "reading another customer's request" -b "$ada" "$API/customer/refund-requests/$(field requestId "$denied")"
pass "customers cannot read each other's requests"

obi=$(sign_in obi.chukwu@example.com WN-H9F3LX)
kettle=$(item_id "$obi" 'Electric kettle, 1 L')
expect_status 422 "#15 item already refunded" -b "$obi" "${CSRF[@]}" "${JSON[@]}" -H 'Idempotency-Key: smoke-scenario-15' \
  -d "{\"orderNumber\":\"WN-H9F3LX\",\"reason\":\"DAMAGED\",\"lines\":[{\"itemId\":\"$kettle\",\"quantity\":1}]}" "$API/customer/refund-requests"
[ "$(field code "$(body)")" = "NOTHING_LEFT_TO_REFUND" ] || fail "#15 should answer NOTHING_LEFT_TO_REFUND: $(body)"
pass "#15 item already refunded: 422 NOTHING_LEFT_TO_REFUND"

echo "Smoke test passed."
