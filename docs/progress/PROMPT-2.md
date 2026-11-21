# PROMPT-2 — The full journey (gates G2 and G3)

Status: **built and verified locally on a production build; the deployed-link part of G2/G3 is blocked on the same two credentials as G1** (a Supabase database password and `vercel login`). No AI Gateway key is configured on this machine, so live runs here take every model fallback; the AI paths are verified with the AI SDK's own mock models.

## Plan and commits

| Step | What | Commit |
| --- | --- | --- |
| 1 | AI layer; `case.process` pipeline; case, officer, complaint, payout, consent, helper, scam and assistant APIs; persona SPECIMEN documents; demo fixtures | `4b4a5bd` |
| 2 | Permission tests for every new endpoint (role, tenant, grant, consent); G2 journey test | `27e3ed5` |
| 3 | Citizen app C1–C14, Helper Mode H1–H4, officer console O1–O4 and O6, 157-clip prompt library, STT bake-off and clip scripts, Playwright beats 1/2/3/5/6 | `775997a` |
| 4 | This report, README | (this commit) |

The route wrapper, domain types and Prompt 1 tables are unchanged in name. New columns only (migration `0004`); still 52 tables.

## What was built

**AI layer (`src/ai`).** Everything goes through Vercel AI Gateway with AI SDK 7.0.178. Model IDs were read from the installed `@ai-sdk/gateway` catalogue and live in `system_config` `models.ids`, so the admin can swap them without a redeploy:

| Job | Model |
| --- | --- |
| Extraction, officer summaries, policy answers | `google/gemini-3.8-flash` |
| Jev decisions | `typesafe-ai/jev` |
| Speech-to-text | `elevenlabs/scribe-v2`, then `upliftai/scribe`, then Gemini audio |
| Fallback classifier | `google/gemini-3.5-flash-lite` |
| Embeddings | `google/gemini-embedding-001` |

- **Extraction:** Zod schemas for CNIC and death certificate, format checks, and cross-field checks (no dates in the future). One retry with the validation error, then the fallback.
- **Jev** (`experimental_decide`, of which the PRD's `experimental_evaluate` is now a deprecated alias): neutral keys `opt_a`–`opt_e`, with meaning mapped back in code. Used for scam type, citizen intent, complaint severity (it can only raise the rule-based minimum), the escalate-only second opinion, and the injection check.
- **Officer summary:** four fixed headings. Every sentence must cite an evidence ID; uncited sentences are dropped, and a template takes over if needed.
- **Policy answers:** full-text plus trigram retrieval over the 19 clauses. A validator checks that every citation was retrieved and every quote is a substring of its clause; otherwise the answer is "I am not sure; a person will call you" and an officer query opens.
- **Logging:** every call, including failures and "not configured", is a row in `ai_calls` (model, prompt version, tokens, latency, estimated cost). Scam verdicts, intent routing, complaint triage, policy answers and skipped second opinions are rows in `ai_decisions`.

**Pipeline (`src/services/pipeline`, `src/jobs/inngest.ts`).** `case.process` runs the 17 steps of §22.1 over a `Stepper`: Inngest `step.run`/`step.sleepUntil` when `INNGEST_EVENT_KEY` is set, otherwise inline after the response (`next/server` `after`).

| Steps | What happens |
| --- | --- |
| 1–2 | Lock the case; check consent |
| 3 | Transcribe pending voice |
| 4 | QR decode with Ed25519 verification against the mock issuer; sharpness (Laplacian variance, calibrated: clean ≈ 0.95, blurred ≈ 0.02); 64-bit difference hash |
| 5 | Gemini extraction, then a comparison of the printed text with the signed QR |
| 6 | Injection patterns plus a Jev check (escalate only) |
| 7–8 | Identity registry (Fellegi–Sunter) and civil registry, in parallel; every tool call is audited with `actor_type = agent` |
| 9 | Duplicates; helper anomalies (shared wallet, night bulk edits, payout change near a payment) |
| 10–13 | Rules, score and the pure `decide()` |
| 14 | Explanations; one immutable decision row with input hash, decision hash and all versions |
| 15 | Notify |
| 16 | Cooling-off hold |
| 17 | Mock payment, idempotent on the payment ID |

Consent is re-checked before every step from 3 on; a withdrawal pauses the case, holds payments and stops the run. Any exception ends in `in_review` with an officer alert, never an approval. Payments and payout changes are released by the Inngest cron or lazily on reads.

**APIs.** 48 new route files, all built with `route()` and listed in OpenAPI. They cover the whole §21.2 catalogue for cases, the officer, money, consent, helpers, scams, the assistant and audit, plus `GET /me/cases`, `GET /me/notifications`, `PATCH /me` and `POST /assist/intent`.

- Document upload is keyed by the photo's SHA-256 (a resend is the same document).
- Voice upload returns a transcript for read-back. Demo audio is never stored once transcribed; a failed transcription queues the encrypted clip for step 3.
- The light status response is about 1.5 KB.
- The "press 9" objection needs no sign-in but carries an HMAC reference that only the notice to the old number contains.

**UI.**

- **Citizen (`/c`):**
  - C1 language pictures; C2 30 trust pictures, each named aloud; C3 PIN entered twice; C4 consent cards with PIN; C5 five tiles.
  - C6 one question per screen with voice read-back, falling back to icons and never guessing; keypad and district icons.
  - C7 camera with on-phone blur check and compression to 1280 px / about 200 KB; C8 review; C9 status with shape-coded check icons and composed voice (amounts built from clips).
  - C10 proof, C11 "Is this real?", C12 receipt, C13 My data (holders, access log, stop sharing with voice warning and PIN, corrections), C14 mock phone with the demo scam SMS and "press 9".
  - Every write goes through the IndexedDB outbox, with ticks.
- **Helper (`/h`):** family grid (avatars, masked CNIC, frozen flags); unlock with the family's PIN; a family banner with a countdown that warns 2 minutes before the end; auto-lock; activity log.
- **Officer (`/o`):**
  - O1 queue: priority, stop badges, confidence vs bar, filters, J/K/Enter.
  - O2 case view: leads with the stop and what would settle it; cited summary, source chips, candidates with per-field weights, rule trace with clauses, contributions, documents with zoom, timeline; actions approve/reject/proof/escalate/assign/freeze/close (A/R/P); replay.
  - O3 payout changes, O4 scam desk with district alerts and map aggregates, O6 complaints and corrections.

**Seeds.** The demo fixtures (two-Fatima S1 case, five helper drafts, recent Hyderabad scam reports) run through the real pipeline after the main seed. Persona wallets and demo wallets (…4417 for Zarina's payout change, …9999 for the helper beat) are seeded. Zarina's trust picture is the mango, as in J1.

## Verification

- `pnpm typecheck` and `pnpm lint` are clean; `pnpm test` runs **194 tests in 13 files, all passing**.
  - `journey.test.ts` — **J1:** draft → answers → three photos (a resend is the same document) → submit (400 without an Idempotency-Key) → proof request for the blurred certificate → clear retake → **AUTO_APPROVE** with a hold → mock ledger pays Rs 12,000 exactly once → "received less" gives a severity-3 complaint in the officer queue.
  - `journey.test.ts` — **G2:** the Fatima case is in the queue under S1 → the full view shows the summary, registry-sourced facts, rule trace and ≥ 2 candidates → opening it turns her ticks blue → a reject without a reason is 422 → approve with a reason → **replay identical** → **audit chain verifies**.
  - `p2-guards.test.ts` (53 tests):
    - 14 role denials.
    - Tenant: 6 endpoints return a 404 byte-identical to an unknown ID.
    - Helper: no unlock gives 403 `GRANT_REQUIRED` on all five write/read endpoints; the family PIN unlocks for 2 hours; switching families locks the first; another office's helper gets 404; one wallet entered for two families **freezes both**.
    - Consent: after withdrawal, 7 officer reads return 403 `CONSENT_WITHDRAWN`; the auditor still sees a masked trace; the denials are in her access log as "refused"; granting again resumes into review.
    - Payout change: wrong PIN refused; other office 404; approve → IVR with "Press 9" → objection freezes the change and opens a complaint.
    - Scam: the fake message is **fake** (fee, sender, no such payment) and drafts the Hyderabad alert; the genuine message checked for a customer is not fake and gets no ledger check.
    - With no models available, the pipeline still ends with a person.
- **HTTP smoke test** on `pnpm build && pnpm start` (local Postgres, no AI key): case → in review with all 8 rule checks passing → officer view with a template summary → ticks blue → approve → replay identical → chain intact → scam fake with the alert drafted.
- **Playwright, 13/13** on a Pixel 7 profile after `pnpm demo:reset` (G1 8 + G2 5):
  - **Beat 2:** apply by icons, keypad and camera. The blurry photo is refused on the phone; offline, one grey tick; back online, two grey ticks; exactly one case.
  - **Beat 3:** S1 lead, summary, candidates; reject without a reason refused; approve; replay identical.
  - **Beat 5:** the family PIN unlocks with banner and countdown; one wallet on two families shows two frozen cards; payout change → officer approves → "press 9" on the mock phone freezes it.
  - **Beat 1:** demo scam SMS → "Is this real?" → **fake**, "never charges fees" → the officer approves the Hyderabad alert.
  - **Beat 6:** withdraw with voice warning and PIN → the officer page shows "Access withdrawn by the citizen" and the API returns 403 → her access log shows "refused".

## G2 / G3 status

| Gate item | Status |
| --- | --- |
| A case from the citizen's phone reaches an officer with a full trace | ✅ tests, HTTP smoke test and Playwright; ⏳ deployed link |
| The officer approves it | ✅ |
| Replaying it gives the same decision | ✅ (`identical: true`, canonical hashes) |
| The audit chain verifies | ✅ |
| Beats 1, 2, 3, 5, 6 (citizen, helper, officer parts) | ✅ locally in Playwright; ⏳ deployed link |
| Tests for every new endpoint (role, tenant, consent, grant) | ✅ |

**Blocked on:** the Supabase database password for `DATABASE_URL`/`DATABASE_URL_DIRECT`, and `vercel login`. Then: `pnpm db:migrate && pnpm demo:reset`, copy `.env.local` into Vercel, `vercel deploy --prod`, and `E2E_BASE_URL=<url> pnpm test:e2e`. For the real models, add `AI_GATEWAY_API_KEY` (or use Vercel OIDC); for durable steps, `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.

## Deviations from the PRD (and why)

1. **`experimental_decide`, not `experimental_evaluate`.** In the installed AI SDK, `evaluate` is a deprecated alias of `decide`.
2. **No speech-to-text bake-off result yet.** It needs a gateway key and synthesised D4 audio, and neither is available here. `pnpm stt:bakeoff` measures WER, digit accuracy and latency per provider and prints the order for `models.ids.stt`. Until then the default is the PRD's order: Scribe, then Uplift, then Gemini audio. **The Uplift endpoint URL could not be verified** against official docs (it is not on the gateway), so it is configurable via `UPLIFT_STT_URL`.
3. **Voice clips are still placeholders.** There are 157 (the prompt asked for about 120), Roman-Urdu text read by the Windows voice as 8 kHz WAV, not Opus (no encoder on this machine). 73 are precached and the rest cached on first play. `pnpm voice:generate` regenerates them from the Urdu text through the gateway's speech model. Dynamic read-back of a transcript uses the phone's own speech engine; fixed words use the clips.
4. **Without an AI key, live cases go to an officer.** Extraction is unavailable, so QR-to-text agreement stays "unknown" (0.5) and the score falls below the 98% bar. With a key (or in tests with mock models) Zarina auto-approves.
5. **Photos and voice clips are stored encrypted (AES-256-GCM) in `bytea` columns** instead of Supabase Storage. Voice audio is nulled as soon as it is transcribed.
6. **Steps 10–11 run inside the pure `decide()`.** The pipeline evaluates them once for the second opinion's features. Step 14 builds the explanations before the single immutable decision row is written, because decision rows cannot be updated.
7. **Officer summary, evidence and contributions are stored in `decisions.explanation_auditor.officer`**, not a new column.
8. **Officer actions are decision rows** with outcomes `APPROVED`, `REJECTED`, `REQUEST_PROOF` and `ESCALATED`, a reason code, and a link to the system decision. Replay replays that system decision and reports the override.
9. **No verification agent with tool calling.** The deterministic plan (the PRD's fallback) always runs every check; registry calls are audited as `actor_type = agent`.
10. **Policy retrieval has no embeddings yet.** It is full-text plus trigram; clause embeddings are not computed. An uncertain answer opens an officer query as a severity-0 complaint (`channel = policy_query`).
11. **Helpers can enter a wallet number while answering.** It is stored only as a proposal and never changes the payout destination (`POST /payout-changes` is 403 for helpers). It is checked by the shared-wallet rule, which is how beat 5 is triggered.
12. **Routes that call a mock service mid-request run without one wrapping transaction** (scam check, complaint create and view, receipt). Each write is its own statement. On a single-session database the nested connection would otherwise wait on the request's transaction.
13. **Scam claims are extracted by deterministic rules.** Gemini is used only to read a screenshot. Jev classifies, and can only move a verdict to "not sure". "Is this real?" also asks where the message arrived, for the district map.
14. **Notifications are sent after commit** with tracked status per channel (in-app, mock SMS, mock voice call), not through the `outbox` table and a job. Webhooks (P1) are not built.
15. **The 5-minute background lock is enforced on the phone.** Server tokens still expire after 15 minutes.
16. **The night-edit rule uses Pakistan time** (UTC+5). The "payout change within 7 days of a payment" rule also counts a payment that is scheduled or on hold.
17. **Inline mode has no scheduler.** Due payments and payout changes are released by the Inngest cron when configured, otherwise lazily when status, the queue or the payout list is read.
18. **Not built in this prompt:** admin and auditor screens for AI decisions (the API exists), the rule editor and Twin, the cost slider, and Break It (Prompt 3 scope).
