import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { decryptPii } from '@/auth/crypto';
import type { DbOrTx } from '@/db/client';
import { rowsOf } from '@/db/rows';
import {
  caseFacts, cases, citizens, decisions, documents, identityMatches, modelVersions, payoutChanges, payoutDestinations, programs, proofRequests, ruleSets,
} from '@/db/schema/all';
import type { Outcome, ProposedAction, Snapshot, Versions } from '@/domain/decide';
import type { FactCandidate, FactSource } from '@/domain/facts';
import type { MatcherWeights } from '@/domain/matcher/fellegi-sunter';
import type { Costs, Rule, Thresholds } from '@/domain/rules/schema';
import type { EvidenceFeatures, ScorerArtifact } from '@/domain/scorer';
import { effectiveConfig } from '../config';
import { FINE_REUSE_MAX_BITS, fineDistance } from '../documents/image';

export const OPEN_STATUSES = ['draft', 'submitted', 'processing', 'needs_proof', 'in_review', 'approved_on_hold', 'approved', 'paused_for_consent', 'frozen', 'disputed'] as const;

export async function loadCase(db: DbOrTx, caseId: string) {
  const [row] = await db.select({
    c: cases, programCode: programs.code, amount: programs.benefitAmount, activeRuleSetId: programs.activeRuleSetId,
  }).from(cases).innerJoin(programs, eq(programs.id, cases.programId)).where(eq(cases.id, caseId)).limit(1);
  if (!row) return null;
  const [cz] = row.c.citizenId ? await db.select().from(citizens).where(eq(citizens.id, row.c.citizenId)).limit(1) : [];
  return { ...row.c, programCode: row.programCode, amount: row.amount, activeRuleSetId: row.activeRuleSetId, citizen: cz ?? null };
}
export type LoadedCase = NonNullable<Awaited<ReturnType<typeof loadCase>>>;

export const citizenCnic = (c: LoadedCase) => (c.citizen ? decryptPii(c.citizen.cnicEnc) : null);

export async function latestArtifact<T>(db: DbOrTx, kind: 'scorer' | 'matcher', version?: string): Promise<T> {
  const q = db.select({ artifact: modelVersions.artifact }).from(modelVersions);
  const [row] = version
    ? await q.where(and(eq(modelVersions.kind, kind), eq(modelVersions.version, version))).limit(1)
    : await q.where(eq(modelVersions.kind, kind)).orderBy(desc(modelVersions.createdAt)).limit(1);
  if (!row) throw new Error(`no ${kind} artifact${version ? ` ${version}` : ''}`);
  return row.artifact as T;
}

/** the versions a decision uses: active rule set, latest scorer, and the configured costs (cost slider) */
export async function loadVersions(db: DbOrTx, c: { tenantId: string; activeRuleSetId: string | null }, override?: { ruleSetId?: string; scorerVersion?: string; costs?: Costs }): Promise<Versions> {
  const rsId = override?.ruleSetId ?? c.activeRuleSetId;
  if (!rsId) throw new Error('programme has no active rule set');
  const [rs] = await db.select().from(ruleSets).where(eq(ruleSets.id, rsId)).limit(1);
  if (!rs) throw new Error('rule set not found');
  const scorer = await latestArtifact<ScorerArtifact>(db, 'scorer', override?.scorerVersion);
  let costs = override?.costs;
  if (!costs) {
    const cfg = await effectiveConfig(db, c.tenantId);
    const v = cfg['decision.costs']?.value as Costs | undefined;
    if (v && typeof v.wrongApproval === 'number') costs = { wrongApproval: v.wrongApproval, review: v.review, delay: v.delay };
  }
  const thresholds = { ...(rs.thresholds as Thresholds) };
  const cfg = await effectiveConfig(db, c.tenantId);
  const floor = cfg['decision.floor']?.value;
  if (typeof floor === 'number') thresholds.floor = floor;
  const cap = cfg['payments.autoCap']?.value;
  if (typeof cap === 'number') thresholds.autoCap = cap;
  return { ruleSet: { id: rs.id, version: rs.version, rules: rs.rules as Rule[], thresholds, costs: rs.costs as Costs }, scorer, costs };
}

/** current (non-superseded) facts grouped by key, every candidate with its source and reference (§22.3 lineage) */
export async function factCandidates(db: DbOrTx, caseId: string) {
  const rows = await db.select().from(caseFacts).where(and(eq(caseFacts.caseId, caseId), isNull(caseFacts.supersededBy))).orderBy(caseFacts.createdAt);
  const out: Record<string, FactCandidate[]> = {};
  for (const r of rows) (out[r.key] ??= []).push({ value: r.value, source: r.source as FactSource, ref: r.sourceRef ?? undefined });
  return out;
}

/** Inserts a fact; an older fact with the same key AND source is superseded (history kept, CONS-7). */
export async function putFact(db: DbOrTx, p: { caseId: string; tenantId: string; key: string; value: unknown; source: FactSource; ref?: string | null; by: string }) {
  if (p.value === undefined || p.value === null || p.value === '') return null;
  const [row] = await db.insert(caseFacts).values({ caseId: p.caseId, tenantId: p.tenantId, key: p.key, value: p.value as object, source: p.source, sourceRef: p.ref ?? null, createdBy: p.by }).returning({ id: caseFacts.id });
  await db.update(caseFacts).set({ supersededBy: row!.id }).where(and(eq(caseFacts.caseId, p.caseId), eq(caseFacts.key, p.key), eq(caseFacts.source, p.source), isNull(caseFacts.supersededBy), ne(caseFacts.id, row!.id)));
  return row!.id;
}

/** the newest document of each type (a retake replaces the earlier photo for the decision) */
export async function currentDocuments(db: DbOrTx, caseId: string) {
  const rows = await db.select({
    id: documents.id, docType: documents.docType, storageKey: documents.storageKey, sharpness: documents.sharpness, dhash: documents.dhash,
    qrPayload: documents.qrPayload, qrSigValid: documents.qrSigValid, extraction: documents.extraction, injectionFlag: documents.injectionFlag, createdAt: documents.createdAt,
  }).from(documents).where(eq(documents.caseId, caseId)).orderBy(desc(documents.createdAt));
  const seen = new Set<string>();
  return rows.filter((d) => (seen.has(d.docType) ? false : (seen.add(d.docType), true)));
}

export type Transient = {
  services: Snapshot['services'];
  secondOpinion: Snapshot['secondOpinion'];
  qrTextMismatch: boolean;
  qrTextAgree: number;
  identityAvailable: boolean;
  duplicates: Snapshot['duplicates'];
  anomalies: Snapshot['anomalies'];
  duplicateScore: number;
  helperAnomalyScore: number;
};

/**
 * Builds the decision snapshot from what is stored (facts, documents, matches, proof attempts) plus the run's
 * transient results (service availability, second opinion). Replay and the Twin use the stored snapshot.
 */
export async function buildSnapshot(db: DbOrTx, c: LoadedCase, t: Transient, asOf: string, consentActive: boolean): Promise<Snapshot> {
  const facts = await factCandidates(db, c.id);
  const docs = await currentDocuments(db, c.id);
  const matches = await db.select().from(identityMatches).where(eq(identityMatches.caseId, c.id)).orderBy(identityMatches.rank);
  const proofs = await db.select({ item: proofRequests.item, attempts: proofRequests.attempts }).from(proofRequests).where(eq(proofRequests.caseId, c.id));
  const proofAttempts: Record<string, number> = {};
  for (const p of proofs) proofAttempts[p.item] = Math.max(proofAttempts[p.item] ?? 0, p.attempts);

  const best = matches[0];
  const second = matches[1];
  const marginBits = best && second ? Math.round((best.scoreBits - second.scoreBits) * 1000) / 1000 : null;
  const match = !t.identityAvailable ? null : {
    bestZone: (best?.zone ?? 'none') as 'match' | 'review' | 'non_match' | 'none',
    ambiguous: !!(best && second && second.zone !== 'non_match' && marginBits !== null && marginBits <= 2),
    marginBits, bestScoreBits: best?.scoreBits ?? null, candidates: matches.length,
  };

  const [prior] = await db.select({ outcome: decisions.outcome, proposedAction: decisions.proposedAction, ruleSetId: decisions.ruleSetId, actorType: decisions.actorType })
    .from(decisions).where(and(eq(decisions.caseId, c.id), eq(decisions.actorType, 'system'))).orderBy(desc(decisions.createdAt)).limit(1);
  let priorOut: Snapshot['prior'] = null;
  if (prior?.ruleSetId) {
    const [rs] = await db.select({ version: ruleSets.version }).from(ruleSets).where(eq(ruleSets.id, prior.ruleSetId)).limit(1);
    if (rs) priorOut = { outcome: prior.outcome as Outcome, proposedAction: prior.proposedAction as ProposedAction, ruleSetVersion: rs.version };
  }

  const pending = c.citizenId ? await db.select({ id: payoutChanges.id }).from(payoutChanges)
    .where(and(eq(payoutChanges.citizenId, c.citizenId), inArray(payoutChanges.status, ['pending_officer', 'cooling_off']))).limit(1) : [];

  const qrDocs = docs.filter((d) => d.qrSigValid !== null);
  const anyQrInvalid = docs.some((d) => d.qrSigValid === false);
  const imageReused = await reusedImage(db, c);
  const sharp = docs.map((d) => d.sharpness).filter((x): x is number => typeof x === 'number');
  const totalAttempts = Object.values(proofAttempts).reduce((a, b) => a + b, 0);
  const deathFound = (facts['spouse.deceased'] ?? []).some((f) => f.source === 'registry' && f.value === true);
  const marital = (facts['marriage.date'] ?? []).some((f) => f.source === 'registry');
  const daysSincePayoutChange = await daysSinceLastPayoutChange(db, c.citizenId, asOf);

  const features: EvidenceFeatures = {
    match_weight: Math.max(-20, Math.min(30, best?.scoreBits ?? -20)),
    qr_valid: anyQrInvalid ? 0 : qrDocs.length ? 1 : 0.5,
    qr_text_agree: t.qrTextMismatch ? 0 : t.qrTextAgree,
    death_record_found: deathFound ? 1 : 0,
    marital_link: marital ? 1 : 0,
    duplicate_score: t.duplicateScore,
    image_reuse: imageReused ? 1 : 0,
    sharpness: sharp.length ? Math.min(...sharp) : 0.5,
    proof_attempts: totalAttempts,
    helper_anomaly_score: t.helperAnomalyScore,
    days_since_payout_change: daysSincePayoutChange,
    wallet_shared: t.anomalies.sharedWallet ? 1 : 0,
  };

  return {
    caseId: c.id, asOf, consentActive, facts,
    identity: { match },
    documents: {
      items: docs.map((d) => ({ docType: d.docType, sharpness: d.sharpness })),
      qrSignatureInvalid: anyQrInvalid, qrTextMismatch: t.qrTextMismatch, imageReused, injectionFlag: docs.some((d) => d.injectionFlag),
    },
    proofAttempts,
    duplicates: t.duplicates,
    anomalies: t.anomalies,
    services: t.services,
    secondOpinion: t.secondOpinion,
    payout: { pendingChange: pending.length > 0 },
    amount: c.amount,
    prior: priorOut,
    features,
  };
}

/** DOC-5: an image within 5 bits of an image on ANOTHER citizen's case */
export async function reusedImage(db: DbOrTx, c: LoadedCase) {
  // coarse filter in SQL (64-bit hash within 5 bits), then the fine 1024-bit hash, because fixed-layout cards collide
  const res = await db.execute(sql`
    select d.fine_hash as a, o.fine_hash as b from documents d
    join documents o on o.case_id <> d.case_id and o.dhash is not null and dhash_distance(o.dhash, d.dhash) <= 5
    join cases oc on oc.id = o.case_id
    where d.case_id = ${c.id} and d.dhash is not null and oc.citizen_id is distinct from ${c.citizenId}
    limit 200`);
  return rowsOf<{ a: string | null; b: string | null }>(res).some((r) => !r.a || !r.b || fineDistance(r.a, r.b) <= FINE_REUSE_MAX_BITS);
}

async function daysSinceLastPayoutChange(db: DbOrTx, citizenId: string | null, asOf: string) {
  if (!citizenId) return 365;
  const [r] = await db.select({ at: payoutChanges.createdAt }).from(payoutChanges).where(and(eq(payoutChanges.citizenId, citizenId), eq(payoutChanges.status, 'approved'))).orderBy(desc(payoutChanges.createdAt)).limit(1);
  if (!r) return 365;
  return Math.max(0, Math.min(365, Math.floor((Date.parse(asOf) - r.at.getTime()) / 86_400_000)));
}

export async function activeDestination(db: DbOrTx, citizenId: string) {
  const [d] = await db.select().from(payoutDestinations).where(and(eq(payoutDestinations.citizenId, citizenId), eq(payoutDestinations.status, 'active'))).orderBy(desc(payoutDestinations.createdAt)).limit(1);
  return d ?? null;
}

export type { MatcherWeights };
