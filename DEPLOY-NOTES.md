# Deploy notes (Curve Performance website + Curve Hub)

No secrets in this file or anywhere in the repo. Tokens are added per session through the
environment's secure credential form (host `api.cloudflare.com`), never pasted into chat or files.

## What's live
| What | Cloudflare Worker | Folder | Domains |
|---|---|---|---|
| Website | `curve-site` | `mk-auto/` | curveperformance.co.uk, www |
| Hub | `curve-hub` | `hub/` | hub.curveperformance.co.uk |

Hub resources: D1 `curve-hub` (id in `hub/wrangler.toml`), R2 `curve-hub-files`, cron every 10 min,
`STAFF_MAIL` (Email Routing → mkautoserviceslimited@gmail.com), `EMAIL` (Email Service, customer emails).

Secrets already stored in Cloudflare (survive session restarts, nothing to redo):
ENCRYPTION_KEY, ANTHROPIC_API_KEY, VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY, DVLA_API_KEY,
DVSA_CLIENT_ID/DVSA_CLIENT_SECRET/DVSA_API_KEY/DVSA_TOKEN_URL/DVSA_SCOPE,
BANK_ACCOUNT_NAME/BANK_SORT_CODE/BANK_ACCOUNT_NUMBER.

## The token a session needs to deploy
Cloudflare → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template, then add:
- Account: Workers Scripts Edit, Workers R2 Storage Edit, D1 Edit, Account Settings Read
- Zone (curveperformance.co.uk): Workers Routes Edit, DNS Edit, Email Routing Rules Edit, Zone Read
Save it with the credential form for `api.cloudflare.com` (stored on the environment, injected by the proxy).
The account ID is shown on the Cloudflare dashboard's Workers overview (right-hand side); not secret.

## Deploying
```
cd hub && npm ci && npm run check            # typecheck + unit tests
PORT=8799 bash scripts/verify.sh             # end-to-end smoke tests (local)
npx wrangler d1 migrations apply curve-hub --remote   # only when hub/migrations has something new
npx wrangler deploy
cd ../mk-auto && npx wrangler deploy         # website
```

## Waiting to go live (committed, not deployed yet)
- Invoice PDF layout: tighter rows, compact payment box, work-done lists under a line, headings kept with lines.
- Job title translated with the issue; vehicle details stacked on phones (fixes squeezed Polish labels).

## Still to switch on
- Customer emails from info@: Workers Paid plan ($5/month), then Compute → Email Service → Email Sending →
  Onboard Domain → curveperformance.co.uk.
- Invoices INV-1050 (Sean, HW65 KBU) and INV-1051 (Marcelino Do Rego, YB62 NNR) were made outside the Hub;
  the Hub's invoice counter is still at 1049, so bump it to 1051 (or enter those two invoices in the Hub) before
  making the next invoice there.
