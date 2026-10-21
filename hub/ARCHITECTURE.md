# M&K Hub architecture

One Cloudflare Worker serves the dashboard (`public/`), the JSON API (`src/`) and scheduled work.
Data lives in D1 (SQLite), files (job photos, videos) in R2. Two users, both with full access.

## Layout

```
migrations/0001_init.sql   the data model: the contract every module builds on
src/index.ts               entry: auth gate for /app, API routing, scheduled fan-out
src/lib/                   shared infrastructure (no business logic)
  env.ts        bindings and secrets            router.ts   routes + access levels + origin check
  http.ts       json(), errors, security headers session.ts  cookie sessions
  crypto.ts     passwords, AES-GCM, TOTP         validate.ts input parsing
  db.ts         first/all/run, newId, nextRef    audit.ts    audit(env, user, action, entity, id)
  ratelimit.ts  guard()/record()                 types.ts    shared row types
src/modules/<name>/
  index.ts      routes (and optional scheduled work) for this module only
  service.ts    functions other modules may call: the module's public contract
public/app/js/
  core.js       UI toolkit (api, h, icon, chip, sheet, field, formatting): pages use only this
  app.js        shell, navigation, hash routing
  pages/index.js  page registry
  pages/<name>.js export async function render(view, { params, navigate, refreshCounts })
```

## Module ownership

| Module | Owns tables | Public contract (service.ts) | UI page |
|---|---|---|---|
| auth, system | users, sessions, auth_attempts, audit_log, settings, counters | `getSetting` (system) | settings, today |
| customers | customers | `findOrCreateCustomer` | customers |
| vehicles | vehicles | `lookupVehicle`, `ensureVehicle` | (inside customers, bookings, jobs) |
| bookings | bookings | `createBooking`, `getBooking` | bookings |
| jobs | jobs, job_notes, job_files | `createJobFromBooking` | jobs |
| ai | ai_suggestions | `client.ts: structured()` | (inside jobs) |
| leads, social | social_accounts, social_posts, social_post_targets, comments, leads | `markLeadBooked` | leads, social |
| notifications | outbox | `queueMessage` | (inside settings later) |

Rules:
1. A module writes only its own tables. To change another module's data, call that module's `service.ts`.
2. Every route declares access: `public` (booking form, health), `pending` (mid sign-in) or `user` (default).
3. Every request body goes through `parse()` from `lib/validate.ts`. No raw SQL string building with user input; always `?` parameters.
4. Every create/update/delete calls `audit()`.
5. Secrets come from `env`, never from code or the database in plain text. Tokens at rest use `encrypt()`.
6. External services (DVLA, DVSA, Claude, social platforms) are optional: when a key is missing, the feature degrades
   (manual entry, rule-based fallback, mock adapter in development) and the Settings page shows it as not connected.
7. UI pages import only from `core.js`, never inline `<script>` or `style="..."` attributes (blocked by the CSP);
   use `h()` with the `style` option, which goes through CSSOM.
8. Copy is plain British English written for the two people using it.

## Running locally

```
npm install
bash scripts/verify.sh          # fresh DB, migrations, test user, Hub running, end-to-end checks
npm run check                   # typecheck + unit tests
npx wrangler dev                # then open http://localhost:8787
```

## Deploying (once the Cloudflare account exists)

```
npx wrangler d1 create mk-hub          # put the returned id in wrangler.toml
npx wrangler r2 bucket create mk-hub-files
npx wrangler secret put ENCRYPTION_KEY  # 32 random bytes, base64
npm run db:migrate:remote
MK_PASSWORD='...' node scripts/create-user.mjs --email ... --name ... --remote   # once per person
npm run deploy
```
Put Cloudflare Access in front of the Hub's hostname as a second gate (free for up to 50 users).
