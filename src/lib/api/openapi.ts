/**
 * API-1: OpenAPI 3.1 generated from the same Zod schemas the guard chain validates with, so the docs can
 * never drift from the code. Every route module is listed here; a test fails if a route file is missing.
 */
import { z, type ZodType } from 'zod';
import * as adminChaos from '../../../app/api/v1/admin/chaos/route';
import * as adminConfig from '../../../app/api/v1/admin/config/route';
import * as auditEvents from '../../../app/api/v1/audit/events/route';
import * as auditVerify from '../../../app/api/v1/audit/verify/route';
import * as login from '../../../app/api/v1/auth/login/route';
import * as logout from '../../../app/api/v1/auth/logout/route';
import * as otpRequest from '../../../app/api/v1/auth/otp/request/route';
import * as otpVerify from '../../../app/api/v1/auth/otp/verify/route';
import * as pinSet from '../../../app/api/v1/auth/pin/set/route';
import * as pinVerify from '../../../app/api/v1/auth/pin/verify/route';
import * as cases from '../../../app/api/v1/cases/route';
import * as caseById from '../../../app/api/v1/cases/[id]/route';
import * as caseStatus from '../../../app/api/v1/cases/[id]/status/route';
import * as demoTokens from '../../../app/api/v1/demo/tokens/route';
import * as health from '../../../app/api/v1/health/route';
import * as me from '../../../app/api/v1/me/route';
import * as status from '../../../app/api/v1/status/route';
import * as rAiDecisions from '../../../app/api/v1/ai-decisions/route';
import * as rAiDecisionsById from '../../../app/api/v1/ai-decisions/[id]/route';
import * as rAssistIntent from '../../../app/api/v1/assist/intent/route';
import * as rAssistPolicy from '../../../app/api/v1/assist/policy/route';
import * as rCasesByIdAnswers from '../../../app/api/v1/cases/[id]/answers/route';
import * as rCasesByIdAssign from '../../../app/api/v1/cases/[id]/assign/route';
import * as rCasesByIdClose from '../../../app/api/v1/cases/[id]/close/route';
import * as rCasesByIdDecisions from '../../../app/api/v1/cases/[id]/decisions/route';
import * as rCasesByIdDocuments from '../../../app/api/v1/cases/[id]/documents/route';
import * as rCasesByIdDocumentsDoc from '../../../app/api/v1/cases/[id]/documents/[docId]/route';
import * as rCasesByIdExplanation from '../../../app/api/v1/cases/[id]/explanation/route';
import * as rCasesByIdFreeze from '../../../app/api/v1/cases/[id]/freeze/route';
import * as rCasesByIdProof from '../../../app/api/v1/cases/[id]/proof/route';
import * as rCasesByIdSubmit from '../../../app/api/v1/cases/[id]/submit/route';
import * as rCasesByIdTimeline from '../../../app/api/v1/cases/[id]/timeline/route';
import * as rCasesByIdUnfreeze from '../../../app/api/v1/cases/[id]/unfreeze/route';
import * as rCasesByIdVoice from '../../../app/api/v1/cases/[id]/voice/route';
import * as rComplaints from '../../../app/api/v1/complaints/route';
import * as rComplaintsById from '../../../app/api/v1/complaints/[id]/route';
import * as rComplaintsByIdResolve from '../../../app/api/v1/complaints/[id]/resolve/route';
import * as rCorrections from '../../../app/api/v1/corrections/route';
import * as rCorrectionsByIdApprove from '../../../app/api/v1/corrections/[id]/approve/route';
import * as rCorrectionsByIdReject from '../../../app/api/v1/corrections/[id]/reject/route';
import * as rDecisionsById from '../../../app/api/v1/decisions/[id]/route';
import * as rDecisionsByIdReplay from '../../../app/api/v1/decisions/[id]/replay/route';
import * as rHelperActivity from '../../../app/api/v1/helper/activity/route';
import * as rHelperFamilies from '../../../app/api/v1/helper/families/route';
import * as rHelperGrants from '../../../app/api/v1/helper/grants/route';
import * as rHelperGrantsById from '../../../app/api/v1/helper/grants/[id]/route';
import * as rMeAccessLog from '../../../app/api/v1/me/access-log/route';
import * as rMeCases from '../../../app/api/v1/me/cases/route';
import * as rMeConsents from '../../../app/api/v1/me/consents/route';
import * as rMeConsentsByIdWithdraw from '../../../app/api/v1/me/consents/[id]/withdraw/route';
import * as rMeCorrections from '../../../app/api/v1/me/corrections/route';
import * as rMeNotifications from '../../../app/api/v1/me/notifications/route';
import * as rPaymentsByIdReceipt from '../../../app/api/v1/payments/[id]/receipt/route';
import * as rPayoutChanges from '../../../app/api/v1/payout-changes/route';
import * as rPayoutChangesByIdApprove from '../../../app/api/v1/payout-changes/[id]/approve/route';
import * as rPayoutChangesByIdBlock from '../../../app/api/v1/payout-changes/[id]/block/route';
import * as rPayoutChangesByIdObject from '../../../app/api/v1/payout-changes/[id]/object/route';
import * as rQueue from '../../../app/api/v1/queue/route';
import * as rScamAlerts from '../../../app/api/v1/scam/alerts/route';
import * as rScamAlertsByIdApprove from '../../../app/api/v1/scam/alerts/[id]/approve/route';
import * as rScamAlertsByIdDismiss from '../../../app/api/v1/scam/alerts/[id]/dismiss/route';
import * as rScamCheck from '../../../app/api/v1/scam/check/route';
import * as rScamDesk from '../../../app/api/v1/scam/desk/route';
import * as rScamDuress from '../../../app/api/v1/scam/duress/route';
import * as rScamDuressByIdResolve from '../../../app/api/v1/scam/duress/[id]/resolve/route';
import * as rScamMap from '../../../app/api/v1/scam/map/route';
import * as rScamReportsByIdLabel from '../../../app/api/v1/scam/reports/[id]/label/route';
import * as rAdminApiKeys from '../../../app/api/v1/admin/api-keys/route';
import * as rAdminApiKeysByIdRevoke from '../../../app/api/v1/admin/api-keys/[id]/revoke/route';
import * as rAdminUsers from '../../../app/api/v1/admin/users/route';
import * as rAdminUsersByIdRevokeSessions from '../../../app/api/v1/admin/users/[id]/revoke-sessions/route';
import * as rAdminWebhooks from '../../../app/api/v1/admin/webhooks/route';
import * as rAdminWebhooksById from '../../../app/api/v1/admin/webhooks/[id]/route';
import * as rAdminWebhooksDeliveries from '../../../app/api/v1/admin/webhooks/deliveries/route';
import * as rAdminWebhooksDeliveriesByIdReplay from '../../../app/api/v1/admin/webhooks/deliveries/[id]/replay/route';
import * as rAuditAnchors from '../../../app/api/v1/audit/anchors/route';
import * as rAdminRetention from '../../../app/api/v1/admin/retention/route';
import * as rAdminOutbox from '../../../app/api/v1/admin/outbox/route';
import * as rAdminPlan from '../../../app/api/v1/admin/plan/route';
import * as rAdminAnalytics from '../../../app/api/v1/admin/analytics/route';
import * as rAdminPolicyEmbed from '../../../app/api/v1/admin/policy/embed/route';
import * as rVoiceTts from '../../../app/api/v1/voice/tts/route';
import * as rAuthMfaVerify from '../../../app/api/v1/auth/mfa/verify/route';
import * as rMeMfaSetup from '../../../app/api/v1/me/mfa/setup/route';
import * as rMeMfaConfirm from '../../../app/api/v1/me/mfa/confirm/route';
import * as rAuthSwitchTenant from '../../../app/api/v1/auth/switch-tenant/route';
import * as rMeTenants from '../../../app/api/v1/me/tenants/route';
import * as rMeExport from '../../../app/api/v1/me/export/route';
import * as rAuditReads from '../../../app/api/v1/audit/reads/route';
import * as rRulesDraftsByIdSuggest from '../../../app/api/v1/rules/drafts/[id]/suggest/route';
import * as rAuditAccess from '../../../app/api/v1/audit/access/route';
import * as rAuditBreakGlass from '../../../app/api/v1/audit/break-glass/route';
import * as rDecisions from '../../../app/api/v1/decisions/route';
import * as rEvalBreakIt from '../../../app/api/v1/eval/break-it/route';
import * as rEvalCostPreview from '../../../app/api/v1/eval/cost-preview/route';
import * as rEvalMetrics from '../../../app/api/v1/eval/metrics/route';
import * as rEvalRuns from '../../../app/api/v1/eval/runs/route';
import * as rEvalRunsById from '../../../app/api/v1/eval/runs/[id]/route';
import * as rRules from '../../../app/api/v1/rules/route';
import * as rRulesDrafts from '../../../app/api/v1/rules/drafts/route';
import * as rRulesDraftsById from '../../../app/api/v1/rules/drafts/[id]/route';
import * as rRulesDraftsByIdApprove from '../../../app/api/v1/rules/drafts/[id]/approve/route';
import * as rRulesDraftsByIdPreview from '../../../app/api/v1/rules/drafts/[id]/preview/route';
import * as rRulesDraftsByIdPublish from '../../../app/api/v1/rules/drafts/[id]/publish/route';
import * as rRulesDraftsByIdTwin from '../../../app/api/v1/rules/drafts/[id]/twin/route';
import * as rTwinRunsById from '../../../app/api/v1/twin-runs/[id]/route';
import { MOCK_ROUTES } from '@/services/mocks/router';
import { ERROR_CODES } from '../errors';
import type { RouteSpec } from './route';

type AnySpec = RouteSpec<unknown, unknown, unknown>;
type Mod = Record<string, unknown>;

export const ROUTE_MODULES: Record<string, Mod> = {
  health, status, me, login, logout, otpRequest, otpVerify, pinSet, pinVerify, demoTokens, cases, caseById, caseStatus,
  adminConfig, adminChaos, auditEvents, auditVerify,
  rAiDecisions, rAiDecisionsById, rAssistIntent, rAssistPolicy, rCasesByIdAnswers, rCasesByIdAssign, rCasesByIdClose, rCasesByIdDecisions, rCasesByIdDocuments, rCasesByIdDocumentsDoc, rCasesByIdExplanation, rCasesByIdFreeze, rCasesByIdProof, rCasesByIdSubmit, rCasesByIdTimeline, rCasesByIdUnfreeze, rCasesByIdVoice, rComplaints, rComplaintsById, rComplaintsByIdResolve, rCorrections, rCorrectionsByIdApprove, rCorrectionsByIdReject, rDecisionsById, rDecisionsByIdReplay, rHelperActivity, rHelperFamilies, rHelperGrants, rHelperGrantsById, rMeAccessLog, rMeCases, rMeConsents, rMeConsentsByIdWithdraw, rMeCorrections, rMeNotifications, rPaymentsByIdReceipt, rPayoutChanges, rPayoutChangesByIdApprove, rPayoutChangesByIdBlock, rPayoutChangesByIdObject, rQueue, rScamAlerts, rScamAlertsByIdApprove, rScamAlertsByIdDismiss, rScamCheck, rScamDesk, rScamDuress, rScamDuressByIdResolve, rScamMap, rScamReportsByIdLabel,
  rAdminApiKeys, rAdminApiKeysByIdRevoke, rAdminUsers, rAdminUsersByIdRevokeSessions, rAdminWebhooks, rAdminWebhooksById, rAdminWebhooksDeliveries, rAdminWebhooksDeliveriesByIdReplay, rAuditAccess, rAuditBreakGlass, rDecisions, rEvalBreakIt, rEvalCostPreview, rEvalMetrics, rEvalRuns, rEvalRunsById, rRules, rRulesDrafts, rRulesDraftsById, rRulesDraftsByIdApprove, rRulesDraftsByIdPreview, rRulesDraftsByIdPublish, rRulesDraftsByIdTwin, rTwinRunsById,
  rAuditAnchors, rAdminRetention, rAdminOutbox, rAdminPlan, rAdminAnalytics, rAdminPolicyEmbed, rVoiceTts, rAuthMfaVerify, rMeMfaSetup, rMeMfaConfirm, rAuthSwitchTenant, rMeTenants, rMeExport, rRulesDraftsByIdSuggest, rAuditReads,
};

export function allSpecs(): AnySpec[] {
  const out: AnySpec[] = [];
  for (const m of Object.values(ROUTE_MODULES)) {
    for (const k of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const h = m[k] as { spec?: AnySpec } | undefined;
      if (h?.spec) out.push(h.spec);
    }
  }
  return out;
}

const js = (s: ZodType) => {
  const j = z.toJSONSchema(s, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
  delete j.$schema;
  return j;
};

function paramsFrom(schema: ZodType | undefined, where: 'path' | 'query') {
  if (!schema) return [];
  const j = js(schema) as { properties?: Record<string, unknown>; required?: string[] };
  return Object.entries(j.properties ?? {}).map(([name, s]) => ({ name, in: where, required: where === 'path' || (j.required ?? []).includes(name), schema: s }));
}

const problemRef = { $ref: '#/components/schemas/Problem' };

export function buildOpenApi(baseUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const s of allSpecs()) {
    if (s.path.startsWith('/api/mock/')) continue;
    const errorCodes = ['400', '401', '403', '404', '422', '429', '500'];
    const op: Record<string, unknown> = {
      operationId: s.operationId,
      summary: s.summary,
      tags: s.tags,
      security: s.auth === 'public' ? [] : [{ bearer: [] }, { apiKey: [] }, { cookie: [] }],
      parameters: [
        ...paramsFrom(s.params, 'path'),
        ...paramsFrom(s.query, 'query'),
        ...(s.idempotency === 'required' ? [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 128 }, description: 'Required on creates and money writes (API-3). Missing → 400 IDEMPOTENCY_KEY_REQUIRED; a repeat returns the stored response with Idempotent-Replayed: true.' }] : []),
        ...(s.idempotency === 'optional' ? [{ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string' } }] : []),
      ],
      responses: {
        [String(s.responseStatus ?? 200)]: { description: 'OK', content: { 'application/json': { schema: s.response ? js(s.response) : {} } } },
        ...Object.fromEntries(errorCodes.map((c) => [c, { description: Object.entries(ERROR_CODES).filter(([, v]) => String(v.status) === c).map(([k]) => k).join(', ') || 'Error', content: { 'application/problem+json': { schema: problemRef } } }])),
      },
    };
    if (s.body) op.requestBody = { required: true, content: { 'application/json': { schema: js(s.body) } } };
    (paths[s.path] ??= {})[s.method.toLowerCase()] = op;
  }
  // the six SIMULATED services, one operation per endpoint
  for (const r of MOCK_ROUTES) {
    const p = '/api/mock/' + r.pattern.replace(/:([a-z]+)/g, '{$1}');
    const op: Record<string, unknown> = {
      operationId: `mock_${r.service}_${r.method.toLowerCase()}_${r.pattern.replace(/[^a-z]/g, '_')}`,
      summary: `[SIMULATED] ${r.summary}`, tags: ['Mock services (SIMULATED)'], security: [], 'x-simulated': true,
      description: 'A labelled mock. Honours the chaos settings (latency, timeout rate, error rate) of its service.',
      parameters: [...[...r.pattern.matchAll(/:([a-z]+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } })), ...paramsFrom(r.query, 'query')],
      responses: { 200: { description: 'OK (simulated: true)' }, 503: { description: 'Simulated outage (chaos)', content: { 'application/problem+json': { schema: problemRef } } } },
    };
    if (r.body) op.requestBody = { required: true, content: { 'application/json': { schema: js(r.body) } } };
    (paths[p] ??= {})[r.method.toLowerCase()] = op;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'AMANAT AI API (prototype)',
      version: '0.1.0',
      description: DESCRIPTION(baseUrl),
    },
    servers: [{ url: baseUrl }],
    tags: [
      { name: 'Auth' }, { name: 'Cases' }, { name: 'Admin' }, { name: 'Audit' }, { name: 'Ops' },
      { name: 'Mock services (SIMULATED)', description: 'Every response carries simulated: true. Nothing reaches a real registry, bank or phone.' },
    ],
    paths,
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: '15-minute access token from /auth/login, /auth/pin/verify or /demo/tokens' },
        apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'Tenant-bound, scoped partner key' },
        cookie: { type: 'apiKey', in: 'cookie', name: 'amanat_session', description: 'Browser session; writes also need a same-origin Origin header' },
      },
      schemas: {
        Problem: {
          type: 'object', description: 'RFC 9457 problem details',
          required: ['type', 'title', 'status', 'detail', 'code', 'requestId'],
          properties: {
            type: { type: 'string', format: 'uri' }, title: { type: 'string' }, status: { type: 'integer' }, detail: { type: 'string' },
            code: { type: 'string', enum: Object.keys(ERROR_CODES) }, requestId: { type: 'string' },
          },
        },
      },
    },
  };
}

const DESCRIPTION = (base: string) => `**Prototype — not an official service.** All people, documents and government systems are simulated.

### Try it with curl (API-6, demo mode)

\`\`\`bash
BASE=${base}
# a 15-minute token for any demo role: citizen, helper, officer, admin, auditor
TOKEN=$(curl -s -X POST $BASE/api/v1/demo/tokens -H 'content-type: application/json' -d '{"role":"officer"}' | jq -r .token)
curl -s $BASE/api/v1/me -H "Authorization: Bearer $TOKEN"

# a create without Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED
CIT=$(curl -s -X POST $BASE/api/v1/demo/tokens -H 'content-type: application/json' -d '{"role":"citizen"}' | jq -r .token)
curl -s -X POST $BASE/api/v1/cases -H "Authorization: Bearer $CIT" -H 'content-type: application/json' \\
  -d '{"programCode":"SAAYA-WS","channel":"citizen","clientSubmissionId":"demo-sub-0001"}'
# the same call with a key, sent twice → one case; the second answer has Idempotent-Replayed: true
curl -s -i -X POST $BASE/api/v1/cases -H "Authorization: Bearer $CIT" -H 'Idempotency-Key: demo-key-0001' -H 'content-type: application/json' \\
  -d '{"programCode":"SAAYA-WS","channel":"citizen","clientSubmissionId":"demo-sub-0001"}'

# another tenant's case → 404 NOT_FOUND, identical to an unknown id
PUNJAB=$(curl -s -X POST $BASE/api/v1/demo/tokens -H 'content-type: application/json' -d '{"role":"officer","email":"officer.bilal@punjab.amanat.test"}' | jq -r .token)
curl -s $BASE/api/v1/cases/<sindh-case-id> -H "Authorization: Bearer $PUNJAB"

# admin: chaos panel and audit chain
ADMIN=$(curl -s -X POST $BASE/api/v1/demo/tokens -H 'content-type: application/json' -d '{"role":"admin"}' | jq -r .token)
curl -s -X PUT $BASE/api/v1/admin/chaos -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{"service":"identity","latencyMs":0,"timeoutRate":1,"errorRate":0}'
curl -s -X POST $BASE/api/v1/audit/verify -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{}'
\`\`\`

Errors are RFC 9457 problem documents with a stable \`code\` and the \`requestId\`. Every response carries \`X-Request-Id\` and \`RateLimit-*\` headers.`;
