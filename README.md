# AMANAT AI — prototype

**Prototype — not an official service.** Every person, document, phone number and government system here is synthetic or a labelled mock. Coder's Cup '26, "The Last Mile: AI on Public Rails". Full spec: [docs/PRD.md](docs/PRD.md). Build log: [docs/progress/](docs/progress/).

## What runs today (gates G1–G3)

| Area | Where |
| --- | --- |
| Single guard chain for every API route: request ID → auth (JWT / API key / cookie) → rate limit → Zod → authorize (role → tenant → grant → consent) → Idempotency-Key → one transaction + audit event → RFC 9457 | [src/lib/api/route.ts](src/lib/api/route.ts), [src/auth/policy.ts](src/auth/policy.ts) |
| 45 platform + 7 `mock` tables, RLS on all, verbatim §20.3 audit chain | [src/db/schema/](src/db/schema/), [src/db/migrations/](src/db/migrations/) |
| Staff email + password; citizen phone code (mock inbox only) + 4-digit PIN, 5 tries → 15 min lock | [src/services/auth.ts](src/services/auth.ts) |
| Six SIMULATED services with chaos settings; adapters with timeout, retry, circuit breaker | [src/services/mocks/](src/services/mocks/), [src/services/adapters/](src/services/adapters/) |
| Pure decision core: three-valued rules, Fellegi–Sunter matcher, logistic + isotonic scorer, `decide()` with 12 stops | [src/domain/](src/domain/) |
| Synthetic data generator and offline training (seed 2026) | [ml/](ml/), output in [data/](data/) |
| App shell: banner, Urdu RTL / English, service worker, offline outbox with ticks | [app/](app/), [src/offline/](src/offline/) |
| AI layer via Vercel AI Gateway (Gemini 3.8 Flash, Jev, Urdu STT), every call in `ai_calls` | [src/ai/](src/ai/) |
| `case.process`: 17 consent-gated steps, Inngest or inline; every failure ends with a person | [src/services/pipeline/](src/services/pipeline/), [src/jobs/](src/jobs/) |
| Citizen C1–C14, Helper H1–H4, Officer O1–O4 + O6 | [src/components/](src/components/), [app/](app/) |

## Run it locally (no Docker, no cloud account)

```bash
pnpm install
cp .env.example .env.local        # then fill the secrets (see the file); ml/generate.py adds the issuer key
pnpm db:local                     # terminal 1: local Postgres 17 (PGlite) on :54329
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres DB_POOL_MAX=1 DB_FETCH_TYPES=false
pnpm db:migrate && pnpm db:seed   # 52 tables; tenants, demo accounts, mock registry, rule set v3, policy, models
pnpm build && PORT=3100 pnpm start
pnpm demo:reset && pnpm test:e2e  # G1 + G2/G3 Playwright suites against :3100 (needs fresh demo data)
```

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test` (unit, golden, PGlite integration), `pnpm test:coverage`.

Optional keys (`.env.example`): `AI_GATEWAY_API_KEY` for the real models (without it every model step takes its documented fallback), `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` for durable steps. `pnpm stt:bakeoff` and `pnpm voice:generate` need the gateway key. Build log for this phase: [docs/progress/PROMPT-2.md](docs/progress/PROMPT-2.md).

Data: `python ml/generate.py --seed 2026` then `python ml/train.py` (requirements in [ml/requirements.txt](ml/requirements.txt)). Both have a `--check` mode that CI uses to prove the committed files reproduce.

## Deploy (Vercel + Supabase, Mumbai)

Supabase project `amanat-ai` (ap-south-1): `https://qoaebsinblteljwzzhxo.supabase.co`.

1. In Supabase → Project Settings → Database, copy the **pooled** connection string (transaction mode, port 6543) as `DATABASE_URL` and the **direct** one (port 5432) as `DATABASE_URL_DIRECT`.
2. `pnpm db:migrate && pnpm db:seed` with those set.
3. `vercel login`, `vercel link`, then add every variable from `.env.example` to the Vercel project (Production), and `vercel deploy --prod`. The region is pinned to `bom1` (Mumbai) in [vercel.json](vercel.json).

## Try the API with curl (demo mode)

Interactive reference with ready-made curl commands: `/api/docs`.

```bash
BASE=https://<deployment>
TOKEN=$(curl -s -X POST $BASE/api/v1/demo/tokens -H 'content-type: application/json' -d '{"role":"officer"}' | jq -r .token)
curl -s $BASE/api/v1/me -H "Authorization: Bearer $TOKEN"
```

Demo roles: `citizen`, `helper`, `officer`, `admin`, `auditor` (Sindh tenant by default; add `"email":"officer.bilal@punjab.amanat.test"` for the Punjab tenant). Tokens live 15 minutes. Demo passwords and PINs are only in environment variables, never in the repository.

## What is real and what is simulated

| Real (running code) | Simulated (labelled) |
| --- | --- |
| Pipeline, decisions, replay, consent gates, helper grants and anomaly freezes, payout protection, complaints, scam verdict rules; AI calls through the gateway when a key is set | Persona documents in `data/documents/persona-*.png` (print them for the demo) |
| Auth, sessions, PIN lockout, RBAC + tenant + consent checks, idempotency, rate limits, audit hash chain, RLS, rule engine, matcher, scorer, decision policy, offline outbox | Identity registry, civil registry, payment ledger and wallets, SMS / IVR gateway, complaint system, document issuer — all under `/api/mock`, every response `simulated: true` |
| | All people, CNICs (`00000-…`), phones (`+9200000…`), documents (SPECIMEN watermark) and the Saaya programme itself |
| | Urdu voice prompts are placeholders until the TTS bake-off (see PROMPT-1 deviations) |

No WhatsApp, no email, no real SMS: nothing leaves the mock inbox.
