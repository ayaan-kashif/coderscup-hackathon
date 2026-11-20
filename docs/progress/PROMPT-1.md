# PROMPT-1 — Foundation (gate G1)

Status: **built and verified locally; cloud deployment pending two credentials** (see "G1 status").

## Plan and commits

| Step | What | Commit |
| --- | --- | --- |
| 0 | Git repo, PRD moved to `docs/PRD.md`, plan | `f7a2f1b` |
| 1 | Next.js 16 App Router (TS strict), Tailwind 4, shadcn/ui primitives, pnpm, ESLint, Vitest, GitHub Actions, `vercel.json` (bom1), §19 layout | `db57c3d` |
| 2 | Drizzle schema, 45 platform + 7 `mock` tables, verbatim §20.3 audit chain, `has_active_consent`, RLS on every table | `47c9933` |
| 5 | Six mock services, chaos settings, adapters (timeout, retry with jitter, circuit breaker) | `66c8286` |
| 3–4 | Auth (staff, citizen OTP + PIN), five roles, three tenants; the single API guard chain | `e81b4b3` |
| 7 | Pure decision core with golden tests | `f2e5d8f` |
| 6 | Generator, policy, rule sets v1–v3, documents, training, seed loader | `8181138` |
| 8 | Health, status, OpenAPI + docs, demo tokens, admin config and chaos, audit search and verify | `40e8415` |
| 9 | App shell, offline outbox and ticks, service worker, voice prompts, consoles, Playwright G1 suite | `7c58c7c` |

Steps 3–5 were committed out of order (the OTP flow needed the SMS adapter), so commit `66c8286` alone does not build; every later commit does.

## What was built

**Foundation (step 1).** `app/` route groups `(citizen)/c`, `(helper)/h`, `(staff)/o|a|au`, `api/v1`, `api/mock`, `api/docs`; `src/{domain,services,ai,jobs,db,auth,lib,offline}`; `ml/`, `data/`, `public/voice/ur`, `tests/`. CI runs lint → typecheck → tests with coverage (≥70 % lines in `src/domain`; currently 96 %) → build, a Python job that checks the generator and trainer reproduce the committed data, and an E2E job (local Postgres, migrate, seed, build, Playwright).

**Database (step 2).** 52 tables exactly (test asserts the list). Migrations: `0000` extensions and Supabase role/`auth.uid()` shims (no-ops on Supabase), `0001` generated tables, `0002` §20.3 code as written, `0003` RLS on every table in `public` and `mock`, narrow `auth.uid()` policies on `cases` and `notifications`, immutable `decisions`, the 40-family helper cap, immutable published rule sets, `dhash_distance()`. Tests prove: concurrent writers give a gap-free `seq`; an edit to any of six columns is caught at that row; a deleted middle row and a deleted tail are caught; the guard blocks UPDATE/DELETE; `has_active_consent` respects purpose, category, withdrawal and expiry; browser roles read nothing without a policy.

**Auth (step 3).** Staff and helpers: email + password (argon2id), `.test` domain enforced by a CHECK constraint and Zod. Citizens: `POST /auth/otp/request` (3 per phone per 10 min, 10 per IP per hour, fails closed) writes the code only to `mock.sms_messages`; `/auth/otp/verify` gives a stage-`otp` token that opens nothing personal; `/auth/pin/verify` (5 wrong → 15 min lock, counted in a transaction that commits on failure) gives the full token. Tenants `sindh`, `punjab`, `sandbox`; 14 fictional staff, 3 persona citizens + 118 helper families.

**Guard chain (step 4).** `route()` in `src/lib/api/route.ts` is the only way an API handler is built (a test scans every `route.ts`). Another tenant's resource → 404 byte-identical to an unknown id, with `TENANT_MISMATCH` in the audit log; consent failures → 403 `CONSENT_WITHDRAWN` logged against the citizen; creates without `Idempotency-Key` → 400 `IDEMPOTENCY_KEY_REQUIRED`; same key + different body → 422; 5 parallel replays → one case, four `Idempotent-Replayed: true`. Every denial is an audit event. Cookie writes need a same-origin `Origin`; Bearer and API keys do not.

**Mocks (step 5).** Identity (get, search incl. one-digit CNIC slips), civil (death, marriage), ledger (list, idempotent record), SMS / IVR (send, inbox, call), complaints (file, status), issuer (keys). Every response has `simulated: true` and `X-Simulated: true`; each reads `chaos_settings` (latency, timeout rate, error rate). Adapters: per-service timeouts from §22.1, full-jitter retries only for idempotent calls, a breaker that opens after 5 failures in 30 s and half-opens after 30 s; outages surface as `DEPENDENCY_UNAVAILABLE` (→ S8), never a guess. Responses are Zod-validated.

**Data (step 6).** `ml/generate.py --seed 2026`: D1 500 cases in the exact B.1 mix (D1-0147 is the B.6 Zarina record), split 300/100/100 by person and stratified; D2 300 messages (B.4 counts, four language forms, some scams copy the official sender); D3 500 name pairs with stored comparison levels; D4 30 clip texts; D5 40 questions; D6 60 documents (52 PNGs + 8 reuses) with SPECIMEN watermark and Ed25519-signed QR (`AMQR1.<payload>.<sig>`); the fictional policy with 19 clause IDs (`SRP-POL-x.y`); rule sets v1–v3; mock registry (1,030 records incl. planted near-duplicates), civil events, wallets, ledger. All CNICs `00000-…`, phones `+9200000…`. `ml/train.py` exports `data/models/matcher-v1.json` and `scorer-v1.json`.

**Decision core (step 7).** No I/O, no clock, no randomness (ESLint enforces it in `src/domain`). Golden tests: each of S1–S12 fires alone on its case; 0.979 → review, 0.981 → approve; Rs 5,000 wrong-approval cost → 90.4 % bar; 90 % floor; replay of stored JSON gives byte-identical output; missing DOB → proof request; models only escalate. TS/Python parity: all 500 D3 pairs give identical levels; scorer probabilities match Python to 5 decimals.

| Model metric (frozen test splits) | Result | PRD target |
| --- | --- | --- |
| Matcher auto-match precision / recall / review zone (D3 test, n=200) | 1.00 / 1.00 / 1 % | 1.00 / ≥0.90 / ≤10 % |
| Scorer ECE, scored categories (D1 test) | 0.046 | ≤0.05 |
| Clean cases escalated by the threshold alone | 2 / 50 | ≤50 % |
| Score-only wrong approvals | 8 / 23 bad — all rule-ineligible (7) or ambiguous identity (1), which stops S12 / S1 route first; 0 in forged, duplicate, helper-fraud | 0 after stops (full pipeline is Phase 2) |

**Endpoints (step 8).** `/api/v1/health`, `/api/v1/status` (DB, 52 tables, rate limiter, mocks + circuits, every chain verified), `/api/docs` (Scalar) + `/api/docs/openapi.json` (OpenAPI 3.1 from the same Zod schemas, with curl examples per role), `POST /api/v1/demo/tokens` (15 min, demo mode only, else 404), `GET|PUT /api/v1/admin/config` (validated keys, returns the new bar), `GET|PUT /api/v1/admin/chaos`, `GET /api/v1/audit/events` (auditor all / admin config events / officer one case), `POST /api/v1/audit/verify`. Also, to exercise the guards: `POST /api/v1/cases`, `GET /api/v1/cases/{id}`, `GET /api/v1/cases/{id}/status`, `GET /api/v1/me`, logout, PIN set.

**Shell (step 9).** Prototype banner on every page (root layout); SIMULATED badges; Urdu RTL / English via a cookie and next-intl; citizen app with speaking keypad, phone code from the mock phone, PIN, trust-picture header, auto-playing prompt + replay; Dexie outbox (`{id, type, payload, attempts, status}`) with `Idempotency-Key = id`, backoff 1 s … 5 min with jitter, triggers on open / online / 30 s, ticks grey1 → grey2 → blue2; service worker precaching the shell and all clips; officer, admin (costs + chaos panel), auditor (verify + events) and helper (40 avatar cards, masked CNIC) consoles; on-screen mock phone that reads the code aloud; `/status` page.

## Verification

- `pnpm typecheck`, `pnpm lint`: clean. `pnpm test`: 133 tests, 11 files, all pass.
- Against a production build on a local Postgres (PGlite over the wire): migrations (52 tables) and seeds run clean and are idempotent; every role signs in; all six mocks answer; Playwright G1 suite **8/8 pass** on a Pixel 7 Chromium profile, including **"a voice prompt plays with the network off"** (shell reloaded from the service-worker cache, clip plays with `currentTime > 0`).

## G1 status

| G1 item | Status |
| --- | --- |
| Every role logs in | ✅ locally (Playwright + curl); ⏳ on the deployed link |
| Migrations and seeds run clean | ✅ locally and in tests; ⏳ on Supabase `amanat-ai` (Mumbai, created) |
| Mocks respond | ✅ |
| A voice prompt plays with the network off | ✅ (placeholder clip, see below) |
| Typecheck, lint, tests pass | ✅ |

Blocked on two things only the owner can provide: the Supabase **database password** (not exposed to the MCP tools) for `DATABASE_URL`/`DATABASE_URL_DIRECT`, and a **`vercel login`** on this machine. Then: `pnpm db:migrate && pnpm db:seed`, copy `.env.local` values to Vercel, `vercel deploy --prod`.

## Deviations from the PRD (and why)

1. **PRD location.** It arrived as `AMANAT_AI_PRD_v2.md` at the repo root; moved to `docs/PRD.md` as the prompt expects.
2. **Auth is our own, not Supabase Auth.** Tokens are HS256 JWTs signed by the server (15 min, Supabase-compatible `sub`/`role`/`aud` claims so `auth.uid()` works in RLS if `AUTH_JWT_SECRET` is the project's JWT secret). Reason: the citizen OTP must land only in our mock inbox (Supabase needs a public Send-SMS hook configured in the dashboard), demo tokens must be mintable, and tests and CI must run without a hosted project. Staff MFA (P1) is not built.
3. **Extra columns, no extra tables.** e.g. `users.kind/password_hash/otp_*`, `citizens.name_display/pin_failed_attempts/pin_locked_until`, `programs.active_rule_set_id`, `rule_sets.tenant_id`. Still 52 tables; drizzle's journal lives in its own `drizzle` schema.
4. **CNIC and wallet encryption** is application-level AES-256-GCM with an HMAC lookup (§23.3) rather than `pgcrypto` (§20.2 wording), so keys stay in env vars.
5. **§20.3 code is verbatim**; added around it: `search_path` pinned for Supabase's `extensions` schema, a trigger that creates each tenant's chain head, the §20.4 indexes. Denials are written to the actor's own tenant chain so a probe does not touch the other tenant's chain.
6. **Rule format** adds an optional `on_unknown: NEEDS_PROOF:<item>` (F5 needs to know which document can supply a missing fact).
7. **Disputed facts are unknown to the rules.** When two strong sources disagree (registry "alive", certificate "died"), only S2 fires; no proposed rejection rests on a disputed fact. Found by the golden S2 test.
8. **S3** fires when a needed proof item has used its 2 attempts; before that the case gets a proof request. **S4** also covers ESCALATE rules and empty rule sets. **S8** also fires when the identity result is missing.
9. **Matcher weights** are estimated by supervised counting on D3 (Laplace smoothing), not Splink; `u` comes from random non-matches only (the over-sampled hard negatives made name agreement look like counter-evidence); thresholds: upper ≥ 4 bits above any estimate-set non-match. Levels: exact, phonetic, close (JW ≥ 0.9), different; DOB adds swapped and ±1 year; CNIC adds one-digit "near".
10. **Scorer** excludes rule-ineligible and ambiguous-identity cases from fit and calibration (rules and S1 decide those), clips output to [0.005, 0.995]. ECE over the whole test split including excluded categories is 0.118 — reported, not hidden.
11. **Documents** are drawn with Pillow (not SVG templates). The forged-QR key is a deliberately public dummy key. The real issuer private key exists only in `.env.local`.
12. **Voice.** No Urdu TTS was available offline here, so the 21 prompt clips are **placeholders**: Roman-Urdu text spoken by the Windows built-in voice, 16 kHz 8-bit WAV (~1 MB total), not ~120 Opus clips. `scripts/voice/prompts.json` holds the Urdu text for the bake-off to regenerate. D4 ships texts only.
13. **Service worker is hand-written** (`public/sw.js`) instead of Serwist, which targets webpack while Next 16 builds with Turbopack. The page hands the worker the assets it already loaded so they work offline on the first visit.
14. **i18n** uses next-intl with a cookie (no locale routing). Citizen screens are fully bilingual; staff consoles are English apart from the shell.
15. **Rate limiting** falls back to an in-memory limiter when Upstash is not configured (shown as "degraded" on `/status`).
16. **Mock transport** is in-process by default (same handlers and chaos, no extra hop on serverless); set `MOCK_BASE_URL` to call the HTTP endpoints.
17. **Chaos settings are global** (the mocks have no tenant), so any admin can set them; every change is audited in that admin's chain.
18. **Not yet wired:** Inngest, Sentry, AI Gateway / Gemini / Jev, Supabase Storage and Realtime (ticks poll instead) — Phase 2 onwards.
19. **Local Postgres** is PGlite over the wire (`pnpm db:local`), with `DB_POOL_MAX=1` and `DB_FETCH_TYPES=false` (its socket server drops postgres-js type lookups); never used in production.
20. **TypeScript 5.9**, not 7.0 (the native compiler is not yet supported by Next.js tooling).
