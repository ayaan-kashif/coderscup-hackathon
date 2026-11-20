# PROMPT-1 — Foundation (gate G1)

Status: in progress. This file records the plan, then what was built and every deviation from `docs/PRD.md`.

## Plan

| Step | What | Commit |
| --- | --- | --- |
| 0 | Git repo, PRD moved to `docs/PRD.md`, this plan | `chore: init` |
| 1 | Next.js 16 App Router (TS strict), Tailwind 4, shadcn/ui primitives, pnpm, ESLint, Vitest, GitHub Actions CI, Vercel config, folder layout of PRD §19 | `feat(step1)` |
| 2 | Drizzle schema for the 45 platform tables + 7 `mock` tables (§20.2), SQL migrations for the audit chain (§20.3 verbatim), `has_active_consent`, RLS on every table; PGlite-backed integration tests | `feat(step2)` |
| 3 | Auth: staff email + password (argon2id), citizen phone OTP into mock SMS inbox + 4-digit PIN (5 tries → 15 min lock), 5 roles, tenants Sindh / Punjab / sandbox | `feat(step3)` |
| 4 | One API wrapper: request ID → authN (JWT / API key) → rate limit (Upstash, memory fallback) → Zod → authorize (role → tenant → grant → consent) → Idempotency-Key → one transaction + audit event → RFC 9457 | `feat(step4)` |
| 5 | Six mock services under `/api/mock` with chaos settings; adapters with timeout, retry with jitter, circuit breaker | `feat(step5)` |
| 6 | `ml/generate.py --seed 2026`: Appendix B datasets D1–D6, Saaya policy with clause IDs, rule set v3, seed data, SPECIMEN PNGs with Ed25519-signed QR; `ml/train.py` exports scorer + matcher JSON | `feat(step6)` |
| 7 | Pure `src/domain`: three-valued rules, Fellegi–Sunter matcher, logistic + isotonic scorer, `decide()` with 12 stops and the F6 cost threshold; golden tests | `feat(step7)` |
| 8 | `/api/v1/health`, `/api/v1/status`, `/api/docs` (OpenAPI 3.1 from Zod), `POST /api/v1/demo/tokens`, admin config + chaos, audit events + verify | `feat(step8)` |
| 9 | App shell: prototype banner, SIMULATED badges, Urdu RTL / English, service worker, Dexie outbox with idempotent sync and ticks, offline voice prompt | `feat(step9)` |
| 10 | Provision Supabase (Mumbai), run migrations + seed, deploy instructions, G1 check, final write-up | `docs: G1` |
