# AMANAT AI — prototype

**Prototype — not an official service.** Every person, document, phone number and government system here is synthetic or a labelled mock. Coder's Cup '26, "The Last Mile: AI on Public Rails". Full spec: [docs/PRD.md](docs/PRD.md). Build logs: [PROMPT-1](docs/progress/PROMPT-1.md) · [PROMPT-2](docs/progress/PROMPT-2.md) · [PROMPT-3](docs/progress/PROMPT-3.md).

> **We help a widow who cannot read receive her relief payment safely and in full, even though she cannot fill the form, her records do not match, and scammers and middlemen are after the same money.**

**Deployed:** `<paste the Vercel URL here after `vercel deploy --prod`>` · **Demo video:** `<Google Drive link>`

> AI reads, mocks confirm, rules decide, people sign off. A widow who cannot read applies by voice on a weak signal; the system acts alone only when the evidence clears a bar set by the cost of a mistake, and otherwise hands the case to an officer with the reason and the one fact that would settle it.

## Contents

[Quick start](#quick-start) · [Brief coverage](#brief-coverage) · [Demo accounts and curl](#demo-accounts-and-curl-per-role) · [Architecture](#architecture) · [Features](#features-one-section-each) · [Decision maths](#the-decision-maths) · [Evaluation](#evaluation-results) · [Break It](#break-it) · [Tests](#tests) · [Real vs simulated](#what-is-real-and-what-is-simulated) · [Limits](#limits-we-state-openly) · [Deploy](#deploy-vercel--supabase-mumbai)

## Quick start

### Prerequisites
- Node.js >= 22
- pnpm >= 10.x (`npm install -g pnpm`)

### Option A: Cloud Supabase Setup (Recommended)
1. Copy the environment template:
   ```bash
   cp .env.example .env.local
   ```
2. In `.env.local`, set your Supabase database URLs (`DATABASE_URL` transaction pooler on port 6543, and `DATABASE_URL_DIRECT` session mode on port 5432).
3. Apply migrations and seed sample demo fixtures:
   ```bash
   pnpm db:migrate
   pnpm demo:reset
   ```
4. Start the development server:
   ```bash
   pnpm dev
   ```
5. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### Option B: 100% Offline Local Setup (No Cloud / No Docker)
No external database or API keys required: every service falls back gracefully.

1. **Terminal 1 — Start the local PGlite PostgreSQL database (port 54329):**
   ```powershell
   pnpm db:local
   ```
2. **Terminal 2 — Migrate & Start Next.js:**
   ```powershell
   pnpm db:migrate
   pnpm demo:reset
   pnpm dev
   ```
3. Open [http://localhost:3000](http://localhost:3000).

> [!TIP]
> **Windows Tip:** If port 54329 or 3000 is stuck (`EADDRINUSE`), free them with:
> ```powershell
> Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
> ```

---

## Environment Configuration (.env.local)

| Variable | Required? | Purpose & Fallback Behavior |
| :--- | :---: | :--- |
| `DATABASE_URL` | **Yes** | Primary PostgreSQL connection string (Supabase transaction pooler on port 6543 or local PGlite on port 54329). |
| `DATABASE_URL_DIRECT` | Optional | Direct PostgreSQL connection string (port 5432) used for `pnpm db:migrate`. Falls back to `DATABASE_URL`. |
| `AUTH_JWT_SECRET` | **Yes** | HS256 secret (min 32 chars) for signing 15-minute access tokens. Compatible with Supabase JWT. |
| `PII_ENC_KEY` | **Yes** | 32-byte AES-256-GCM base64 key for encrypting CNIC numbers & wallet details. |
| `PII_HMAC_PEPPER` | **Yes** | Cryptographic pepper for blind index lookups. |
| `API_KEY_PEPPER` | **Yes** | Pepper string for hashing staff & agency API keys. |
| `AI_GATEWAY_API_KEY` | Optional | Powers Gemini 3.8 Flash, Jev, ElevenLabs Scribe and text-to-speech. The Vercel account behind it needs a card on file or the gateway answers 403. *Fallback: deterministic rules & person-in-the-loop.* |
| `VERIFICATION_AGENT` | Optional | `on` turns on the bounded verification agent (escalate-only; needs the gateway key). |
| `CRON_SECRET` | Optional | Opens `/api/cron/*`, the scheduler fallback when Inngest is not configured. |
| `UPLIFT_API_KEY` | Optional | Uplift AI Speech-to-Text API for Urdu voice transcription. *Fallback: icon selection / manual text.* |
| `INNGEST_EVENT_KEY` / `SIGNING_KEY` | Optional | Durable asynchronous background event queues. *Fallback: synchronous inline execution.* |
| `UPSTASH_REDIS_REST_URL` / `TOKEN` | Optional | Global distributed rate limiter. *Fallback: in-memory rate limiting.* |
| `SENTRY_DSN` | Optional | Zero-PII error tracking and performance monitoring. *Fallback: standard structured console logs.* |
| `DEMO_MODE` | Optional | Enables `/api/v1/demo/tokens` and instant role-picker on `/`. Set to `false` for live deployments. |
| `DEMO_ACCESS_CODE` | Optional | A private code that unlocks demo sign-in (the role picker and `/api/v1/demo/tokens`). On Vercel, demo sign-in stays closed unless this is set, so a public link cannot open every role. Share the code only with judges. |
| `DEMO_STAFF_PASSWORD` | Optional | Password for demo staff accounts (`<set DEMO_STAFF_PASSWORD in .env.local>`). |
| `DEMO_CITIZEN_PIN` | Optional | 4-digit PIN for the demo citizens. Set it in `.env.local`; it is never printed here or committed. |

## Brief coverage

Every item of the brief, where it is, and how to try it. Everything is synthetic or a labelled mock.

### The 5 roles (the brief asks for 3)
Citizen, community helper, department officer, admin, auditor. **Try:** `/login` → pick a role.

### The 7 core platform features
| Feature | Try |
| --- | --- |
| Secure login with role-based access | `/login`; the generated permission matrix (`tests/integration/permission-matrix.test.ts`, 1,000+ cells). Admins and auditors can turn on TOTP in their console. |
| Dashboard with progress, status and history | Citizen `/c`: "My applications" lists every application with status, ticks and a timeline (tap one). Helper `/h`: each family's status and ticks. Officer `/o`: the queue with counts per stop. |
| Case management (create, assign, escalate, close) | `/o` → open a case → assign, escalate, close; `POST /api/v1/cases`, `/assign`, `/close`. |
| Public REST API with keys and OpenAPI docs | `/api/docs`; `/a/org` → Create key → `curl -H "X-API-Key: …"`. |
| Audit log of every user, AI and agent action | `/au/chain` (hash chain, hourly anchors), `/au` (decisions and AI decisions), `/au/access` (every data read, allowed and refused, with CSV export). |
| Consent management (see, share, withdraw, correct) | Citizen → My data: see who holds it, choose what to share (identity, documents, payout, contact, voice) with the PIN, stop sharing, correct a fact, download your data. |
| Mock identity, payment and data services behind clean APIs | `/api/mock/*` (every response says `simulated: true`); change their speed and failure rate in `/a/chaos`. |

### The 7 optional platform features we picked
| Feature | Try |
| --- | --- |
| Multi-tenant workspaces | Sindh, Punjab and a sandbox office; an officer of another office gets 404 on any case. The admin console header lists only offices where you hold a role (Admin Sana holds two). |
| Admin rule editor | `/a` → New draft → edit → Save → Run the Twin → Publish (a second admin approves a harmful change). |
| Notifications | In-app, mock SMS and voice notes only, through the outbox with retries: `/mock/phone` after any status change. No WhatsApp, no email. |
| Officer review queue with priority and confidence sorting | `/o`. |
| Background jobs and queues | Inngest steps with an inline fallback; the outbox, hourly audit anchor and daily retention sweep; `/a/org` → Background jobs. |
| Rate limiting and error handling | Per-IP, per-actor and per-route limits (Upstash, or in-memory); RFC 9457 errors with request ids; request a sign-in code for the same phone 4 times within 10 minutes and read the 429 and its `Retry-After`. |
| Low-bandwidth and offline mode | Citizen app with the network switched off (DevTools → Offline) or on a 2G / Data Saver connection: no photo previews, slower polling, tick states. |

Also built beyond the minimum: webhooks, tenant analytics (`/a/analytics`), plans and usage limits.

### The 10 AI features (the brief asks for 3)
| Feature | Try |
| --- | --- |
| RAG with citations | Citizen → Help → ask "Am I eligible if my husband died abroad?"; hybrid keyword + vector retrieval over the 19 clauses; an answer without a valid citation is refused. |
| Classification and routing (Jev) | Scam type, intent routing, complaint triage and an escalate-only second opinion; `/au` → AI decisions. |
| Computer vision | Document upload: signed-QR check, blur check, image reuse, extraction, weak signals (editing software, error-level) shown to officers. |
| Voice | Urdu speech-to-text for answers with read-back; text-to-speech for dynamic phrases, cached by text hash. |
| Structured outputs | Zod schemas on every model output; an invalid output is refused, never guessed. |
| Guardrails and human approval | Injection scan; models only add stops; nothing is rejected automatically; no model has a tool that approves, rejects or moves money. |
| Explainability | Citizen (icons and voice), officer (rule trace, evidence contributions) and auditor (full trace, replay) views. |
| Anomaly and duplicate detection | `/h`: one wallet on two families freezes both; duplicate CNIC and near-duplicate people. |
| **Memory and context** | **Case state lives in Postgres** (facts with their source, the immutable decision history, the audit chain); **the phone keeps an IndexedDB outbox** so nothing is lost offline; **the pipeline is resumable** (each step is durable, and a run re-checks consent before every step and continues where it stopped). Try: submit a case, drop the connection mid-way, reconnect, and find exactly one case. |
| Evaluation dashboard | `/a/evaluation`: routing, calibration, scam, matching, documents, RAG with denominators; speed per pipeline stage (p50/p95) and AI cost per case; the cost slider; Break It. |

A bounded verification agent (read-only tools, at most 8 steps, escalate-only) is built but **off by default** (`VERIFICATION_AGENT=on`); it is not claimed until it has run live.

### The 4 bonus features
| Feature | Try |
| --- | --- |
| Helper Mode | `/h`: 40 families, each unlocked with its own PIN; one family withdrawing consent blocks only that family. |
| Offline-first sync | Apply with the network off, reconnect; ticks go grey, grey, blue; one case, however many retries. |
| Digital Twin | `/a` → Run the Twin on a draft → second admin approves → publish → open cases are re-decided; any that would get worse stop at S11. |
| Scam Map | `/map`: filter by time, district and scam type; counts under 3 are hidden; a spike drafts an alert that an officer approves in `/o/scams`. |

Also: **Silent Duress PIN** (a PIN typed backwards looks like a normal sign-in but locks the money down and alerts officers).

### Try lines for the newest pieces
- **Consent by data category:** `/c` → My data → "What you share" → switch off "Photos of documents" → Save with PIN → try to add a photo (403 `CONSENT_WITHDRAWN`, the category named).
- **AI decisions:** `/au` → search → open a scam verdict → its trace (input hash, model, prompt version, probabilities, reason).
- **Auditor read log:** `/au/access` → "Every data read" → filter "Refused" → Export CSV.
- **Admin users:** `/a/org` → Users → change a role, Deactivate (their next request is refused), Reactivate.
- **Speed and cost:** `/a/evaluation` → Live → "Speed per pipeline stage" and "AI cost".
- **Dashboard:** `/c` home → "My applications".
- **Scam Map filters:** `/map?days=30&type=fee_before_payment&district=HYD`.
- **Helper per-family consent:** unlock a family in `/h`, then withdraw that family's consent as the citizen; that family returns 403, the other families still work.

## Demo accounts and curl per role

Demo mode (`DEMO_MODE=true`) issues 15-minute tokens for seeded fictional accounts (20 per minute per IP). Passwords and PINs live only in environment variables (`DEMO_STAFF_PASSWORD`, `DEMO_CITIZEN_PIN` in `.env.local`) and are never printed in this file. Sign in with the demo tokens below, or the role picker on `/login`.

```bash
BASE=https://<deployed-url>           # the deployed link above; use http://localhost:3100 when running locally
tok() { curl -s -X POST $BASE/api/v1/demo/tokens -H 'content-type: application/json' -d "{\"role\":\"$1\"${2:+,\"email\":\"$2\"}}" | jq -r .token; }
CIT=$(tok citizen); HLP=$(tok helper); OFF=$(tok officer); ADM=$(tok admin); AUD=$(tok auditor)
PUN=$(tok officer officer.bilal@punjab.amanat.test); SBX=$(tok admin admin.breakit@sandbox.amanat.test)

# citizen: who am I, my applications, check a message sent to me
curl -s $BASE/api/v1/me -H "Authorization: Bearer $CIT"
curl -s $BASE/api/v1/me/cases -H "Authorization: Bearer $CIT"
curl -s $BASE/api/v1/scam/check -H "Authorization: Bearer $CIT" -H 'content-type: application/json' \
  -d '{"text":"Congratulations, Rs 25,000 relief approved. Send Rs 500 fee to +920000099111 to release.","sender":"+920000099111","sentToMe":true,"ledgerConsent":true,"districtCode":"HYD"}'

# helper: families; anything on a family without its unlock is 403 GRANT_REQUIRED
curl -s $BASE/api/v1/helper/families -H "Authorization: Bearer $HLP"

# officer: the queue; the two-Fatima case is under stop S1
CASE=$(curl -s "$BASE/api/v1/queue?stop=S1" -H "Authorization: Bearer $OFF" | jq -r '.items[0].id')
curl -s "$BASE/api/v1/cases/$CASE?view=full" -H "Authorization: Bearer $OFF" | jq '.systemDecision | {gates, summary}'

# another office's officer gets a 404 identical to an unknown id (tenants are sealed)
curl -s $BASE/api/v1/cases/$CASE -H "Authorization: Bearer $PUN"
curl -s $BASE/api/v1/cases/00000000-0000-4000-8000-000000000000 -H "Authorization: Bearer $OFF"

# a create without an Idempotency-Key is refused, with the fix in the message
curl -s -X POST $BASE/api/v1/cases -H "Authorization: Bearer $CIT" -H 'content-type: application/json' -d '{"programCode":"SAAYA-WS","channel":"citizen","clientSubmissionId":"curl-0001"}'

# admin: the cost slider on the frozen test set (a Rs 5,000 wrong-approval cost gives a 90.4% bar)
curl -s $BASE/api/v1/eval/cost-preview -H "Authorization: Bearer $ADM" -H 'content-type: application/json' -d '{"wrongApproval":5000,"review":300,"delay":200}' | jq '.threshold.required, .at.split'

# auditor: replay a decision, verify the hash chain
DEC=$(curl -s "$BASE/api/v1/decisions?caseId=$CASE" -H "Authorization: Bearer $AUD" | jq -r '.items[0].id')
curl -s -X POST $BASE/api/v1/decisions/$DEC/replay -H "Authorization: Bearer $AUD" | jq .identical
curl -s -X POST $BASE/api/v1/audit/verify -H "Authorization: Bearer $AUD" -H 'content-type: application/json' -d '{}'

# sandbox admin: Break It (admins of real offices get 403)
curl -s -X POST $BASE/api/v1/eval/break-it -H "Authorization: Bearer $SBX"
```

| Role | Account (fictional) |
| --- | --- |
| Citizen | Zarina Bibi, phone +920000000001 (the code arrives on `/mock/phone`); Fatima Bibi +920000000002 |
| Helper | helper.shabana@sindh.amanat.test (40 families) |
| Officer | officer.imran@sindh.amanat.test · senior.officer.hina@sindh.amanat.test · officer.bilal@punjab.amanat.test |
| Admin | admin.sana@sindh.amanat.test · second admin admin.second.omar@sindh.amanat.test · sandbox admin.breakit@sandbox.amanat.test |
| Auditor | auditor.raza@sindh.amanat.test |

## Architecture

Next.js 16 (App Router) on Vercel (Mumbai) · Postgres (Supabase, Mumbai) with Drizzle · AI SDK 7 through Vercel AI Gateway · Inngest, or inline · Upstash rate limits, or in-memory · Sentry (optional).

```
phone (PWA, IndexedDB outbox, service worker)                 staff consoles (/o /a /au) · API clients (keys)
        │ Idempotency-Key = outbox id                                     │
        ▼                                                                 ▼
route(): request id → authenticate → rate limit → Zod → authorize (role → tenant → grant → consent) → Idempotency-Key
         → one transaction + audit event (hash-chained in the database) → RFC 9457 errors
        │
        ├── case.process (17 steps, consent re-checked before each): QR signature · sharpness · image hash · extraction ·
        │   injection scan · identity (Fellegi–Sunter) ‖ civil registry · duplicates and helper anomalies · rules · score ·
        │   Jev second opinion (escalate only) · decide() (pure) · explain · notify · cooling-off · mock payment
        ├── mocks (SIMULATED): identity, civil, ledger + wallets, SMS/IVR, complaints, document issuer — with chaos settings
        └── pure core src/domain: three-valued rules, matcher, logistic + isotonic scorer, decide(), cost threshold, evaluation
```

Code map: [src/lib/api/route.ts](src/lib/api/route.ts) (the only way an API handler is built) · [src/auth/policy.ts](src/auth/policy.ts) (the permission matrix) · [src/domain/](src/domain/) (decision core, no I/O) · [src/services/pipeline/](src/services/pipeline/) · [src/ai/](src/ai/) · [src/db/](src/db/) (54 tables, RLS on all, the §20.3 audit chain) · [ml/](ml/) (generator and training, seed 2026) · [tests/](tests/).

## Features (one section each)

Each section says what the feature does, how to try it, and what is simulated.

### F1 Voice-first application
One question per screen with an Urdu prompt and a replay button. Answers come by voice (read back: "I heard … is that right?"), by icon, or on a speaking keypad; free typing is never needed. **Try:** `/c` → pick a language → sign in with the code from `/mock/phone` → Apply. The 157 prompt clips are synthetic Urdu speech (Microsoft neural voice ur-PK-UzmaNeural via edge-tts, MP3); regenerate with `python scripts/voice/generate-edge.py` or `pnpm voice:generate`. Speech-to-text needs the gateway key; without it the question switches to icons.

### F2 Offline-first sync and ticks
Every answer and photo goes to an IndexedDB outbox first (one grey tick). It syncs in order, with the outbox entry id as the `Idempotency-Key` and backoff with jitter (two grey ticks), and the ticks turn blue when an officer opens the case. **Try:** apply, switch the browser offline part-way, then reconnect. **Simulated:** nothing; the drops are real (or come from the chaos panel).

### F3 Document verification
- The Ed25519-signed QR is verified against the mock issuer's key.
- Sharpness is checked on the phone before upload and again on the server.
- Reuse is detected with a 64-bit and a 1024-bit difference hash.
- Gemini extracts the fields into Zod schemas, and the printed text is compared with the QR.
- Instruction-like text on a document is flagged (S9). If extraction is unavailable, the case goes to a person (S8).

**Try:** print `data/documents/persona-zarina-*.png` (SPECIMEN) and photograph them. **Simulated:** the documents and the issuer.

### F4 Identity resolution
Names are normalised (Urdu and Roman script, honorifics, Muhammad variants) and scored with Fellegi–Sunter weights per field. Two thresholds leave a review zone between them; two candidates within 2 bits fire the ambiguity stop S1; records are never merged automatically. **Try:** officer → queue → the two-Fatima case shows both candidates with per-field weights. **Simulated:** the identity registry.

### F5 Rule engine and rule editor
Rules are JSON with clause IDs, evaluated three-valued (pass, fail, unknown), and every published version is immutable. The editor builds conditions from dropdowns, has a JSON view, validates on the server and previews against any case. **Try:** `/a` → New draft → change a value → Save. **Simulated:** the Saaya policy is fictional.

### F6 Trust and decision engine
`decide(snapshot, versions)` is pure: facts by source strength → rules → calibrated evidence score → 12 hard stops → cost threshold. Nothing is rejected automatically, models can only add stops, decisions are immutable, and a replay is byte-identical. **Try:** auditor → search → Replay. See [the decision maths](#the-decision-maths).

### F7 Officer queue and case summary
- **Queue:** sorted by stop severity, waiting time and vulnerability, then lowest confidence.
- **Case view:** leads with the stop and the one fact that would settle it. It shows a summary whose every sentence cites evidence, source chips on each fact, the identity candidates, the rule trace with clauses, the evidence contributions, the documents and the timeline.
- **Actions:** approve, reject (a reason code is required), request proof, escalate, assign, freeze, close. Shortcuts J/K/A/R/P.

**Try:** `/o`.

### F8 Consent Control Center
The citizen sees who holds her data, hears her access log, and can stop sharing after a voice warning and her PIN.
- After withdrawal, every staff read is refused with `403 CONSENT_WITHDRAWN`, logged, and shown in her log.
- A pipeline that is already running stops at its next step.
- Auditors still see traces, with personal fields removed. For an open complaint they can open break-glass for 30 minutes, and that access is logged too.

**Try:** citizen → My data → Stop sharing; then the officer reloads the case.

### F9 Evidence chain
A database trigger hash-chains every audit event (§20.3, as written in the PRD), and `audit_verify` names the first broken row. **Try:** auditor → Chain integrity → Verify; then edit a row in SQL with the guard disabled and verify again.

### F10 Helper Mode and anomaly freeze
- A helper sees up to 40 families as avatar cards.
- The family's own PIN unlocks its case for 30 idle minutes or 2 hours, with a banner and a countdown; switching families locks the screen.
- Helpers can't change payouts or consent, and never see a full CNIC.
- One wallet on two or more families freezes every affected case.

**Try:** `/h`.

### F11 Payout protection and exact-amount receipt
A payout change needs the citizen's PIN, an officer's approval, a cooling-off period, and a notice to the old number with "press 9"; a 9 freezes the change and opens a complaint. After payment she hears the exact amount and taps "received all" or "received less"; "less" files a high-severity complaint linked to the payment and the helper. **Try:** officer → Payout changes; `/mock/phone` → "9 — this isn't me". **Simulated:** the ledger, wallets, SMS and the voice call.

### F12 "Is this real?" and Scam Map
- **Checks:** claims are extracted and checked against the official senders and the programme rules (no fees, codes or links).
- **Her ledger:** checked only for her own message, with her consent.
- **Jev:** can only move a verdict to "not sure".
- **Map:** confirmed scams build the district map; a spike drafts an alert that an officer approves.

**Try:** `/mock/phone` → "Receive the demo scam SMS" → "Is this real?"; then `/map` and officer → Scam desk.

### F13 Digital Twin
Replays stored snapshots (the last 90 days and every open case) under a draft. It reports changes by direction and district, the payout delta, masked names and in-flight harm. It sends, pays and changes nothing, and each run is tied to the draft's hash.
- A draft that would harm an in-flight case needs a second admin.
- Publishing re-decides open cases, and any that would get worse go to an officer with S11.

**Try:** `/a` → Run the Twin → Publish; sign in as the second admin to approve.

### F14 Cost slider, evaluation dashboard, Break It
Three cost sliders recompute, in milliseconds on the frozen 100-case test set: the threshold, the route split, wrong approvals with their 95% bound, and officer hours. The dashboard shows the §25.2 metrics with their denominators; Break It is described below. **Try:** `/a/evaluation`; `/a/break-it` as the sandbox admin.

### F15 Public API, keys, notifications
REST under `/api/v1`, with OpenAPI 3.1 and curl examples at `/api/docs`. Per-office API keys have scopes, are stored hashed, shown once, and can be revoked. Notifications go in-app, by mock SMS and by voice note only, and never contain links or ask for money. **Try:** `/a/org` → Create key → `curl -H "X-API-Key: …"`. Signed webhooks (`case.decided`, `case.escalated`, `payment.sent`, `consent.withdrawn`) go through the outbox with retries, a delivery log and replay; manage them in `/a/org`. Plans (`/api/v1/admin/plan`) cap cases per month, API calls per minute and AI calls per day per office.

### F16 Policy assistant with citations
Retrieves from the 19 policy clauses. An answer must cite the retrieved clauses with exact quotes; otherwise it says "I am not sure; a person will call you" and opens an officer query. **Try:** citizen → Help. It needs the gateway key to answer; without it, it refuses safely.

### F17 Complaints and corrections queue
- **Severity:** set by rules (Jev may only raise it), then sorted by age.
- **Complaint view:** the payment, the ledger entry, the timeline, the helper's actions and earlier complaints against the helper.
- **Resolution:** needs a reason code.
- **Corrections:** an approved correction becomes an officer fact, the old value is kept, and the case is re-decided.

**Try:** officer → Complaints & corrections.

## The decision maths

Approve alone only if the expected cost of approving is lower than the expected cost of a review:

```
Pr(bad|E) · C_wrong  <  C_review + (1 − Pr(bad|E)) · C_delay
⇔  Pr(bad|E)  <  (C_review + C_delay) / (C_wrong + C_delay)
```

Default costs (labelled assumptions): a wrong approval costs Rs 25,000, a review Rs 300, a legitimate applicant's delay Rs 200. That gives 500 / 25,200 = 1.98%, so auto-approval needs **98.0%** confidence; at Rs 5,000 the same rule gives **90.4%**. A 90% floor always applies, and amounts above Rs 50,000 always go to a person.

Pr(legitimate) comes from a logistic regression over 12 evidence features of this case only, with isotonic calibration. It is trained offline ([ml/train.py](ml/train.py)) and run in TypeScript ([src/domain/scorer.ts](src/domain/scorer.ts)). The 12 hard stops run before the threshold, and golden tests pin 0.979 → review and 0.981 → approve.

## Evaluation results

From `pnpm eval` on the frozen synthetic datasets (seed 2026); the dashboard (`/a/evaluation`) shows the same numbers with their dates. Full report: [data/models/eval-report.json](data/models/eval-report.json).

| Capability | Metric | Result | Target |
| --- | --- | --- | --- |
| Decision routing (D1 test, n=100) | Wrong approvals | **0 / 23** (95% upper bound 13%, rule of three) | 0 |
| | Clean cases sent to a person | 2 / 50 (4%) | ≤ 50% |
| Calibration | Expected calibration error: calibration set / test (scored categories) | 0.005 / 0.046 (all categories: 0.118) | ≤ 0.05 |
| Scam check (D2 test, n=100, claim checks only) | Precision / recall of "fake" | 51/51 / 51/51 | ≥ 95% / ≥ 90% |
| | False alarms on genuine messages | 0 / 36 | ≤ 2% |
| | "Not sure" | 13 / 100 (the unrelated messages) | ≤ 15% |
| Record matching (D3 test, n=200) | Auto-match precision / recall / review zone | 1.00 / 1.00 / 1% | 1.00 / ≥ 0.90 / ≤ 10% |
| Document integrity (D6, n=60) | Edited and forged caught / clean flagged | 24 / 24 · 0 / 20 | 100% / ≤ 1% |
| RAG (D5) | Expected clause in the top 4 retrieved | 27 / 30 | — |
| Not measured here | Citation accuracy, refusals, voice word error rate, Jev label swap | need the gateway or speech keys | |

### Evaluation with the real models

**Status: not yet run.** The model IDs were checked against the gateway's catalogue (`pnpm ai:smoke`), but every gateway call currently returns `403: AI Gateway requires a valid credit card on file`, so the citation accuracy, refusals (D5), voice word error rate and digit accuracy (D4), Jev label swap (D2) and extraction accuracy (D6) have not been measured live. Urdu speech-to-text through Uplift AI works (`UPLIFT_API_KEY`). Once the account has a card: `pnpm ai:smoke`, then `pnpm eval` (frozen test sets only), then Break It as the sandbox admin; attacks #2 and #8 are then expected to be caught by S6 and S9 instead of going to a person under S8. The label-swap check and the other model-dependent steps are covered by tests with mock models in the meantime.

How to read these numbers:
- The scam rules were tuned on D2's tune split and measured on the untouched test split; both score 100%.
- "Edited text caught" uses the printed fields an extraction model would read, so it is an upper bound; live extraction needs the key.
- The synthetic scores are bimodal, so moving the bar from 98.0% to 90.4% changes few routes on this test set.

## Break It

18 attacks, 20 clean control cases and 5 genuine messages checked on someone else's behalf, run through the live pipeline in the sandbox office. These are the results measured **without an AI key** (controls carry no photographs, so they do not need extraction; attacks with photographs go to a person). Live results with the gateway key are measured after the key's account is funded; the run and its output are listed under "Evaluation with the real models" below:

| Result | Attacks | Controls | Genuine messages |
| --- | --- | --- | --- |
| Caught, or passed as expected | 12 caught · 2 passed (#5 name variant matched, #15 genuine message) | 20 approved | 5 not flagged |
| Asked for proof | 2 (#1 blurry photo, #18 missing date of birth) | 0 | |
| Escalated to a person | 2 (#2 edited certificate, #8 hidden instruction) | 0 | |
| False alarm | 0 | 0 | 0 |
| Missed | **0** | | |

Attacks #2 and #8 need the extraction model to be caught. Without the key they go to a person (S8) and are never approved. With the key they are expected to be caught by S6 and S9; that is tested with mock models in `tests/integration/ten-tests.test.ts`. Every result links to its case and decision in `/a/break-it`.

## Tests

`pnpm typecheck && pnpm lint && pnpm test`. `/status` shows the last run ([data/test-summary.json](data/test-summary.json)).

| Suite | What it proves |
| --- | --- |
| Golden decisions (`tests/golden`) | each of S1–S12 fires on its case; 0.979 / 0.981; Rs 5,000 → 90.4%; replay is identical |
| The ten tests of §26.2 (`ten-tests.test.ts`) | 1. no duplicates over 50 replays · 2. consent stops a running pipeline · 3. tenants are sealed · 4. tampering is found at the row · 5. rules go live within 5 s · 6. the threshold boundary · 7. every stop fires · 8. injection is inert · 9. helpers need a grant · 10. outages approve nothing |
| Generated permission matrix (`permission-matrix.test.ts`) | 812 cells: every authorized endpoint × role × other office × other citizen × no grant × withdrawn consent, with the exact status and code |
| Security probes | JWT `alg:none`, forged, elevated, foreign and expired tokens; IDOR; CSRF; revoked sessions and keys; rate limits; SQL-like input; no secrets in git; security headers including CSP |
| Journeys and guards (`journey`, `p2-guards`, `p3-admin`) | apply → proof → approval → exact payment → receipt; S1 → officer → replay → chain; Twin → second admin → publish → S11; Break It |
| Playwright (`tests/e2e`, Pixel 7) | G1 (roles, banner, RTL, offline voice) and every §34 beat; `pnpm demo:twice` resets and runs the whole demo twice in a row |

## What is real and what is simulated

| Component | Status |
| --- | --- |
| Gemini extraction, RAG answers and summaries; Jev decisions; Urdu speech-to-text | Real model calls through Vercel AI Gateway **when `AI_GATEWAY_API_KEY` is set**; without it every step takes its documented fallback (a person decides) |
| Urdu text-to-speech | Pre-generated clips: synthetic Urdu (edge-tts, ur-PK-UzmaNeural), regenerated by `scripts/voice/generate-edge.py` |
| Rule engine, evidence scorer, record matcher, decision policy, Digital Twin, cost slider, Break It | Real, our code |
| Login, roles, tenants, consent enforcement, audit chain, API keys, rate limits, background jobs | Real |
| WhatsApp and email | Not used |
| Identity registry, civil registry, payment ledger, wallets, complaint system, document issuer | Simulated (`/api/mock/*`; every response says `simulated: true`; "SIMULATED" in the UI) |
| SMS gateway and phone calls | Simulated on the on-screen phone (`/mock/phone`) |
| Payments | Simulated; no money moves |
| People, CNICs (`00000-…`), phones (`+9200000…`), documents (SPECIMEN watermark), the Saaya programme and its policy | Fictional and synthetic |
| Dropped connections | Real (offline mode), plus simulated failures from the chaos panel |

## Limits we state openly

- **Calibration is synthetic.** Probabilities are calibrated on generated cases; real calibration needs governed pilot data.
- **The trust picture is weak on its own.** Studies of bank "security images" found most people still typed their passwords when the image was missing. It is only a first layer; the real protection is the claim check and the rule that genuine messages never ask for money, codes or action outside the app.
- **Speech recognition of rare names is imperfect.** Names are confirmed against documents and the registry, never trusted from speech alone.
- **Signed QR codes exist only on our mock documents.** Real unsigned documents get weaker evidence and more human review.
- **Image checks are narrow.** Reuse detection catches identical or re-encoded copies, but not a cropped re-photograph of the same card. Anything beyond that is a hint for officers.
- **Anomaly rules catch patterns, not every theft.** The exact-amount receipt and complaints cover what the rules miss.
- **Mocks are simpler than real registries**, which have other failure modes, latencies and legal limits.
- **Without the gateway key**, the live system sends every case that has photographed documents to a person, because the printed text cannot be read and compared with the signed QR (stop S8). Break It's 20 clean controls are created from form answers and registry records with no document upload, so they never need the extraction model; that is why they are approved with no key while a case with photos is not. With the key, the model-dependent checks (extraction, injection, second opinion, policy answers) have been exercised only by tests using the AI SDK's mock models, not yet on real traffic.

## Deploy (Vercel + Supabase, Mumbai)

1. The Supabase project `amanat-ai` (ap-south-1, `https://qoaebsinblteljwzzhxo.supabase.co`) exists. Put the pooled connection string (port 6543) in `DATABASE_URL` and the direct one (port 5432) in `DATABASE_URL_DIRECT`.
2. Run `pnpm db:migrate && pnpm demo:reset` against it.
3. `vercel login && vercel link`, add every variable from `.env.example` (Production), then `vercel deploy --prod`. The region is pinned to `bom1` in [vercel.json](vercel.json).
4. `pnpm warmup https://<deployment>`, then `E2E_BASE_URL=https://<deployment> pnpm demo:twice`.
