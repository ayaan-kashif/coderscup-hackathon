# PROMPT-3 — Finish (admin, auditor, Break It, tests, ship)

Status: **feature-complete and verified on a local production build; not deployed.** The deployed-link items of §33.5 are blocked on the same two credentials as G1–G3: the Supabase database password (`DATABASE_URL`/`DATABASE_URL_DIRECT`) and a `vercel login`. No AI Gateway key is configured on this machine, so the live system ran every model step's fallback. The model paths are tested with the AI SDK's mock models.

## Commits

| Step | What | Commit |
| --- | --- | --- |
| 1 | Rule drafts, preview, Digital Twin, second-admin publish + re-decide (S11); cost slider; §25 evaluation; Break It; users and API keys; auditor search, consent/access log, break-glass; fixes found by evaluation | `36b72bd`, `14290be` |
| 2 | Admin console A1–A6, auditor console AU1–AU3, Scam Map, permission matrix, the ten tests of §26.2, security probes, Sentry, `/status`, warm-up, `demo:twice`, README, this report | (this commit, tag `v1.0`) |

## What was built

**Admin (`/a`):**
- **A1 rules:** version list, a condition builder from dropdowns (fact, operator, value), a JSON view, server-side validation (an invalid draft cannot be saved) and a preview against a case's stored snapshot.
- **A2 Twin:** changes by direction and district, payout delta, masked affected cases and in-flight harm. A run is tied to the draft's hash, so a changed draft needs a new run.
- **Publishing:** a harmful draft needs a second admin who is not its author. The switch is atomic, and a stale publish gets 409. Open cases are then re-decided in batches of 50, and any that would get worse go to an officer with S11; old decisions keep their version.
- **A3 cost and evaluation:** three cost sliders recompute the threshold, route split, wrong approvals (with the rule-of-three bound), officer hours and the cost curve. This takes about 3 ms on the server, well under the 2-second target. The evaluation dashboard shows each §25.2 metric with its denominator and dataset, the reliability bands, and live numbers (pipeline p50/p95, AI calls, cost per case, officer overrides).
- **A4 Break It:** see below.
- **A5 chaos and config:** latency, timeouts and errors per mock service; model IDs, cooling-off periods, the auto cap, the floor and the inline flag. Every change is audited.
- **A6 organisation:** staff users on `.test` addresses with a one-time password, session revocation, and API keys with scopes (hashed, shown once, revocable).

**Auditor (`/au`):**
- **AU1:** case decisions and AI decisions searched together; a trace with the input hash, rule set, scorer, model and prompt versions, threshold and actor; replay.
- **AU2:** the chain check, which names the first broken row.
- **AU3:** a citizen's consents and every read of her data, allowed and refused, plus break-glass. Break-glass needs an open complaint (or a legal request) and a written reason, lasts 30 minutes, is logged, and appears in her access log.

**Scam Map (stretch, done):** a public `/map` with a schematic district map, a table of counts, the top scam type and spike flags. Fewer than 3 reports shows no count, and there is no personal data.

**Break It:** 18 attacks, 20 clean controls and 5 genuine messages checked on someone else's behalf, all through the live pipeline in the sandbox tenant. Results are per row, linked to their case and decision, with misses kept visible.

**Tests:**
- A generated permission matrix: 812 cells, exact status and code.
- The ten tests of §26.2.
- Security probes.
- An admin flow test.
- Playwright for beats 4 and 7 and the auditor.

`pnpm demo:twice` resets the data and runs the whole browser demo twice.

**Ship:**
- Sentry on the server, only when `SENTRY_DSN` is set; no request bodies or personal data are sent.
- `/status` shows AI, jobs and error reporting, plus the last test-run summary.
- `pnpm warmup <url>` hits 34 checks, from pages to demo tokens for each role, the role APIs, the mocks and the chain.
- `demo:reset` takes about 3 s locally and warns above 2 minutes.
- A Content-Security-Policy header.
- The README: curl per role, one section per feature, real vs simulated, the decision maths, evaluation and Break It results, test results, limits.

## Fixes the evaluation found (and made)

1. **The two Fatimas were auto-approved by Break It.** The mock identity search returned 10 of 30 "Fatima Bibi, Badin" records in arbitrary order, so the near-duplicate twin record was cut off and the matcher saw one clear match. Candidates are now ranked by CNIC, name and husband-name similarity, and stop S1 fires.
2. **An edited certificate was auto-approved without the extraction model.** The genuine QR passed and nothing compared the printed text with it. A failed or unavailable extraction now sends the case to a person (S8), as the PRD's fallback says.
3. **Genuine messages were called fake.** "No fee, no link, no code is ever asked" and "Apna PIN kisi ko na batayein" were read as requests. Negated phrases are now removed before the fee and code checks, and the sender check applies only to a message that claims something about the programme. D2 test: 51/51 scams fake, 0/36 genuine called fake, 13/13 unrelated messages "not sure".
4. **18 of 20 clean documents were flagged as reused images.** Cards of the same layout fall within 5 bits on a 64-bit difference hash. A 1024-bit hash is now required too (migration `0005`). Different people's cards are 51+ bits apart; identical copies are within a few bits. Clean flagged: 0/20.
5. **A role check came after the tenant check.** The generated matrix found `revoke-sessions` answered 404 instead of 403 to non-admins, because its loader filtered by office. It now decides role first.
6. **There was no Content-Security-Policy** (found by the security probe). Added; it allows only our scripts and the pinned API-reference CDN and its fonts, with zero violations on the main pages.

## Verification

- `pnpm typecheck` and `pnpm lint` are clean. `pnpm test` runs **224 tests in 17 files, all passing** (golden 31, unit 28, integration 165), recorded in `data/test-summary.json`.
- **Playwright, 17/17**, Pixel 7 profile: G1 (8), beats 1, 2, 3, 5, 6 (5), and beats 4 and 7 plus the auditor (4).
- `pnpm demo:twice` (reset → all 17 → reset → all 17): **17/17 both times**, about 55 s per run.
- `pnpm warmup http://localhost:3100`: **34/34** checks ok, slowest 70 ms. `/status` says "degraded" only because AI, Inngest and Sentry are not configured here.

| Break It (no AI key) | Attacks (18) | Controls (20) | Genuine messages (5) |
| --- | --- | --- | --- |
| caught / passed | 12 caught, 2 passed | 20 approved | 5 not flagged |
| asked for proof | 2 | 0 | — |
| escalated to a person | 2 (#2 edited text, #8 hidden instruction: both need the extraction model) | 0 | — |
| false alarm | 0 | 0 | 0 |
| missed | **0** | — | — |

## §33.5 definition of done

| Item | Status |
| --- | --- |
| Deployed link works for all five roles from a fresh browser | ⏳ **blocked** (DB password, `vercel login`); all five work on the local production build (Playwright G1) |
| Every demo beat in §34 passes twice in a row on the deployed link | ⏳ deployed link blocked; ✅ locally (`pnpm demo:twice`: 17/17 twice) |
| Break It report lists every attack with its result, misses included | ✅ `/a/break-it`, the README and the table above |
| Role-by-endpoint and cross-tenant API tests pass in CI | ✅ locally (812-cell matrix, guards, ten tests); ⏳ CI has never run (no GitHub remote) |
| README: setup, architecture, real vs simulated, limits, test results, one section per feature, curl per role | ✅ |
| Demo video uploaded to a public Google Drive link | ❌ not something I can do; it needs a person to record and upload |

To finish: put the two connection strings in `.env.local` and run `vercel login`. Then:

```bash
pnpm db:migrate && pnpm demo:reset   # against Supabase
vercel link && vercel deploy --prod  # after adding .env.example's variables in Vercel
pnpm warmup https://<url>
E2E_BASE_URL=https://<url> pnpm demo:twice
```

Push to a GitHub remote so CI runs, and push the `v1.0` tag (`git push origin v1.0`).

## Deviations

1. **Break It attack #11** (rule changed mid-case) runs the re-decide job's function on the stored snapshot with a stricter in-memory version. It does not publish a real version 4 in the sandbox, so every run leaves the sandbox's active rules unchanged. Publish-and-re-decide is tested for real in `p3-admin.test.ts` and in Playwright beat 4.
2. **Break It runs without a gateway key here.** Attacks #2 and #8 are therefore "escalated" (a person decides) rather than "caught"; with mock models they are caught (`ten-tests.test.ts` #8).
3. **The evaluation dashboard reads `pnpm eval` output** (an `eval_runs` row, with `data/models/eval-report.json` as fallback). Metrics that need a model or speech key are shown as "not measured", not estimated.
4. **The permission matrix runs denied cells and allowed reads over HTTP.** Allowed writes are skipped there, because they would mutate the fixtures; the flow suites cover them.
5. **Sentry is server-side only.** There is no browser SDK, so the citizen bundle stays small; client errors go to logs.
6. **The Scam Map is a schematic SVG** with approximate district positions, not a geographic map.
7. **Not built:** webhooks, plans and per-tenant usage limits, tenant analytics (A7), staff MFA, and the LLM verification agent. These are P1/P2 stretch items in the cut order.
