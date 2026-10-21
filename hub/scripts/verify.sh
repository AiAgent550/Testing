#!/usr/bin/env bash
# Full local verification: fresh database, migrations, the Hub running, then every smoke file
# (scripts/smoke.mjs and scripts/smoke-*.mjs), each with its own freshly created user.
set -uo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-8787}
rm -rf .wrangler/state
mkdir -p .wrangler
[ -f .dev.vars ] || printf 'ENCRYPTION_KEY=%s\n' "$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')" > .dev.vars
npx wrangler d1 migrations apply mk-hub --local >/dev/null || exit 1
for f in test/fixtures/*.sql; do [ -f "$f" ] && npx wrangler d1 execute mk-hub --local --file "$f" >/dev/null; done
if fuser "$PORT/tcp" >/dev/null 2>&1; then echo "Port $PORT is busy; stop the other Hub first (fuser -k $PORT/tcp)."; exit 1; fi
# Own process group, so the whole wrangler tree (which restarts workerd if only that dies) stops together.
setsid npx wrangler dev --port "$PORT" --ip 127.0.0.1 > .wrangler/dev.log 2>&1 &
DEV=$!
trap 'kill -- -$DEV 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/api/system/health" >/dev/null && break; sleep 1; done
export HUB_URL="http://127.0.0.1:$PORT"
status=0
for f in scripts/smoke.mjs scripts/smoke-*.mjs; do
  [ -f "$f" ] || continue
  name=$(basename "$f" .mjs)
  export SMOKE_EMAIL="$name@mk.test" SMOKE_PASSWORD="smoke-test-password-123"
  MK_PASSWORD="$SMOKE_PASSWORD" node scripts/create-user.mjs --email "$SMOKE_EMAIL" --name "Smoke ${name#smoke-}" >/dev/null 2>&1
  node "$f" || status=1
done
[ $status -eq 0 ] && echo "VERIFY: all smoke files passed" || { echo "VERIFY: failures (server log: .wrangler/dev.log)"; tail -20 .wrangler/dev.log; }
exit $status
