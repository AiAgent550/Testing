#!/usr/bin/env bash
# Full local verification. Each smoke file (scripts/smoke.mjs, scripts/smoke-*.mjs) gets its own
# fresh database, fixtures, freshly created user and Hub process, so files never affect each other.
set -uo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-8787}
mkdir -p .wrangler
[ -f .dev.vars ] || printf 'ENCRYPTION_KEY=%s\n' "$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')" > .dev.vars
# wrangler.toml holds the production origins; the local Hub must run with local ones.
grep -q '^APP_ORIGIN=' .dev.vars || printf 'APP_ORIGIN=http://localhost:8787\n' >> .dev.vars
grep -q '^SITE_ORIGIN=' .dev.vars || printf 'SITE_ORIGIN=http://localhost:8765\n' >> .dev.vars
if fuser "$PORT/tcp" >/dev/null 2>&1; then echo "Port $PORT is busy; stop the other Hub first (fuser -k $PORT/tcp)."; exit 1; fi

DEV=""
stop_dev() { [ -n "$DEV" ] && kill -- -"$DEV" 2>/dev/null; DEV=""; for _ in $(seq 1 20); do fuser "$PORT/tcp" >/dev/null 2>&1 || break; sleep 0.5; done; }
trap stop_dev EXIT

export HUB_URL="http://127.0.0.1:$PORT"
status=0
for f in scripts/smoke.mjs scripts/smoke-*.mjs; do
  [ -f "$f" ] || continue
  name=$(basename "$f" .mjs)
  rm -rf .wrangler/state
  npx wrangler d1 migrations apply curve-hub --local >/dev/null || { echo "migrations failed"; exit 1; }
  for fx in test/fixtures/*.sql; do [ -f "$fx" ] && npx wrangler d1 execute curve-hub --local --file "$fx" >/dev/null; done
  export SMOKE_EMAIL="$name@mk.test" SMOKE_PASSWORD="smoke-test-password-123"
  MK_PASSWORD="$SMOKE_PASSWORD" node scripts/create-user.mjs --email "$SMOKE_EMAIL" --name "Smoke ${name#smoke-}" >/dev/null 2>&1
  # Own process group, so the whole wrangler tree (which restarts workerd if only that dies) stops together.
  setsid npx wrangler dev --port "$PORT" --ip 127.0.0.1 > ".wrangler/dev-$name.log" 2>&1 &
  DEV=$!
  for _ in $(seq 1 60); do curl -sf "$HUB_URL/api/system/health" >/dev/null && break; sleep 1; done
  node "$f" || { status=1; echo "  (server log: .wrangler/dev-$name.log)"; }
  stop_dev
done
[ $status -eq 0 ] && echo "VERIFY: all smoke files passed" || echo "VERIFY: failures"
exit $status
