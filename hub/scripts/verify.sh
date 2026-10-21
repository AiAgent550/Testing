#!/usr/bin/env bash
# Full local verification: fresh database, migrations, a test user, the Hub running, then the smoke test.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-8787}
rm -rf .wrangler/state
[ -f .dev.vars ] || printf 'ENCRYPTION_KEY=%s\n' "$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')" > .dev.vars
npx wrangler d1 migrations apply mk-hub --local >/dev/null
export SMOKE_EMAIL="smoke@mk.test" SMOKE_PASSWORD="smoke-test-password-123"
MK_PASSWORD="$SMOKE_PASSWORD" node scripts/create-user.mjs --email "$SMOKE_EMAIL" --name "Smoke Test" >/dev/null
npx wrangler dev --port "$PORT" --ip 127.0.0.1 > .wrangler/dev.log 2>&1 &
DEV=$!
trap 'kill $DEV 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/api/system/health" >/dev/null && break; sleep 1; done
HUB_URL="http://127.0.0.1:$PORT" node scripts/smoke.mjs
