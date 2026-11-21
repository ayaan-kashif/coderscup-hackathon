import type { Actor, Role } from './actor';

/** Every action in the PRD §13.1 permission matrix. */
export type Action =
  | 'case.create' | 'case.read' | 'case.decide' | 'case.assign' | 'case.escalate' | 'case.close'
  | 'complaint.read' | 'complaint.resolve'
  | 'payout.request' | 'payout.approve'
  | 'consent.manage' | 'accesslog.read'
  | 'rules.draft' | 'twin.read' | 'rules.publish'
  | 'config.read' | 'config.write'
  | 'breakit.run' | 'breakit.read'
  | 'org.manage' | 'org.read'
  | 'audit.read' | 'audit.verify'
  | 'scam.check' | 'scam.alert.approve'
  | 'self.read'
  | 'case.write' | 'case.status' | 'case.explain' | 'case.freeze' | 'queue.read'
  | 'decision.read' | 'decision.replay' | 'aidecision.read'
  | 'complaint.create' | 'correction.create' | 'correction.review' | 'receipt.confirm'
  | 'helper.work' | 'scam.desk' | 'assist.policy' | 'notifications.read' | 'self.update' | 'audit.breakglass';

type Scope = 'own' | 'grant' | 'tenant' | 'any';
export type ConsentNeed = { purpose: string; category: string };
type Rule = {
  scope: Scope;
  consent?: ConsentNeed;
  mask?: string[];
  /** API keys: required scope */
  apiScope?: string;
  /** only inside the sandbox tenant (Break It) */
  sandboxOnly?: boolean;
  /** narrower meaning for audit reads, applied by the handler */
  view?: string;
};

export const ELIGIBILITY: ConsentNeed = { purpose: 'eligibility_verification', category: 'case' };

const T = (extra: Omit<Rule, 'scope'> = {}): Rule => ({ scope: 'tenant', ...extra });

/** Rows are actions; columns are roles plus `api_key`. A missing cell means "no". */
export const MATRIX: Record<Action, Partial<Record<Role | 'api_key', Rule>>> = {
  'case.create': { citizen: { scope: 'own' }, helper: { scope: 'grant' }, officer: T({ view: 'assisted_intake_with_pin' }), api_key: T({ apiScope: 'cases:write' }) },
  'case.read': {
    citizen: { scope: 'own' },
    helper: { scope: 'grant', mask: ['cnic'] },
    officer: T({ consent: ELIGIBILITY }),
    auditor: T({ mask: ['cnic', 'name', 'dob', 'wallet', 'phone'] }),
    api_key: T({ apiScope: 'cases:read', consent: ELIGIBILITY }),
  },
  'case.decide': { officer: T({ consent: ELIGIBILITY }) },
  'case.assign': { officer: T(), admin: T() },
  'case.escalate': { officer: T() },
  'case.close': { officer: T() },
  'complaint.read': { officer: T(), auditor: T() },
  'complaint.resolve': { officer: T() },
  'payout.request': { citizen: { scope: 'own', view: 'pin' } },
  'payout.approve': { officer: T() },
  'consent.manage': { citizen: { scope: 'own', view: 'pin' } },
  'accesslog.read': { citizen: { scope: 'own' } },
  'rules.draft': { admin: T() },
  'twin.read': { admin: T(), auditor: T() },
  'rules.publish': { admin: T() },
  'config.read': { admin: T(), auditor: T() },
  'config.write': { admin: T() },
  'breakit.run': { admin: T({ sandboxOnly: true }) },
  'breakit.read': { admin: T(), auditor: T() },
  'org.manage': { admin: T() },
  'org.read': { auditor: T() },
  'audit.read': {
    citizen: { scope: 'own', view: 'access_log' },
    helper: { scope: 'any', view: 'own_actions' },
    officer: T({ view: 'case_timeline' }),
    admin: T({ view: 'config_events' }),
    auditor: T({ view: 'all' }),
  },
  'audit.verify': { admin: T(), auditor: T() },
  'scam.check': { citizen: { scope: 'any' }, helper: { scope: 'any' }, officer: { scope: 'any' }, admin: { scope: 'any' }, api_key: { scope: 'any', apiScope: 'scam:check' } },
  'scam.alert.approve': { officer: T() },
  /** answers, documents, voice, submit, proof: her own case, or a helper under a live grant (HELP-4) */
  'case.write': { citizen: { scope: 'own' }, helper: { scope: 'grant' }, api_key: T({ apiScope: 'cases:write' }) },
  'case.status': { citizen: { scope: 'own' }, helper: { scope: 'grant' } },
  'case.explain': {
    citizen: { scope: 'own', view: 'citizen' },
    helper: { scope: 'grant', view: 'citizen' },
    officer: T({ consent: ELIGIBILITY, view: 'officer' }),
    auditor: T({ view: 'auditor', mask: ['cnic', 'name', 'dob', 'wallet', 'phone'] }),
  },
  'case.freeze': { officer: T() },
  'queue.read': { officer: T() },
  'decision.read': { officer: T({ consent: ELIGIBILITY }), auditor: T({ mask: ['cnic', 'name', 'dob', 'wallet', 'phone'] }) },
  'decision.replay': { officer: T({ consent: ELIGIBILITY }), auditor: T() },
  'aidecision.read': { officer: T(), auditor: T() },
  'complaint.create': { citizen: { scope: 'own' }, helper: { scope: 'grant' }, officer: T() },
  'correction.create': { citizen: { scope: 'own' } },
  'correction.review': { officer: T() },
  'receipt.confirm': { citizen: { scope: 'own' } },
  'helper.work': { helper: { scope: 'any' } },
  'scam.desk': { officer: T() },
  'assist.policy': { citizen: { scope: 'any' }, helper: { scope: 'any' }, officer: { scope: 'any' } },
  'notifications.read': { citizen: { scope: 'any' }, helper: { scope: 'any' }, officer: { scope: 'any' }, admin: { scope: 'any' } },
  /** F8: an auditor opens personal fields for an open complaint or a legal request (logged, 30 min) */
  'audit.breakglass': { auditor: T() },
  'self.update': { citizen: { scope: 'any' }, helper: { scope: 'any' }, officer: { scope: 'any' }, admin: { scope: 'any' }, auditor: { scope: 'any' } },
  'self.read': { citizen: { scope: 'any' }, helper: { scope: 'any' }, officer: { scope: 'any' }, admin: { scope: 'any' }, auditor: { scope: 'any' } },
};

/** The resource as loaded by the route, before any data is returned. */
export type ResourceRef = {
  tenantId?: string | null;
  tenantIsSandbox?: boolean;
  citizenId?: string | null;
};

export type Verdict =
  | { allow: true; mask?: string[]; view?: string }
  | { allow: false; status: 403 | 404; code: 'FORBIDDEN_ROLE' | 'NOT_FOUND' | 'GRANT_REQUIRED' | 'CONSENT_WITHDRAWN' | 'SCOPE_MISSING'; reason: string };

export type PolicyDeps = {
  hasLiveGrant: (helperUserId: string, citizenId: string) => Promise<boolean>;
  hasConsent: (citizenId: string, granteeType: 'tenant' | 'helper', granteeId: string, need: ConsentNeed) => Promise<boolean>;
};

const deny = (status: 403 | 404, code: Extract<Verdict, { allow: false }>['code'], reason: string): Verdict => ({ allow: false, status, code, reason });

/**
 * Called by every route before any data is loaded. Order (PRD §13.2): role → tenant → helper grant → consent.
 * Another tenant's resource is a 404 NOT_FOUND, identical to an unknown id; the reason TENANT_MISMATCH is audit-only.
 */
export async function authorize(actor: Actor, action: Action, resource: ResourceRef, deps: PolicyDeps): Promise<Verdict> {
  const column: Role | 'api_key' | null = actor.kind === 'api_key' ? 'api_key' : actor.role;
  const rule = column ? MATRIX[action][column] : undefined;

  // 1. role
  if (!rule) return deny(403, 'FORBIDDEN_ROLE', `ROLE_${column ?? 'none'}_CANNOT_${action}`);
  if (actor.kind === 'api_key' && rule.apiScope && !actor.scopes?.includes(rule.apiScope)) {
    return deny(403, 'SCOPE_MISSING', `SCOPE_MISSING:${rule.apiScope}`);
  }

  // 2. tenant / ownership — never reveal that the resource exists
  if (rule.scope === 'tenant') {
    if (!actor.tenantId) return deny(403, 'FORBIDDEN_ROLE', 'NO_TENANT');
    if (resource.tenantId && resource.tenantId !== actor.tenantId) return deny(404, 'NOT_FOUND', 'TENANT_MISMATCH');
    if (rule.sandboxOnly && !resource.tenantIsSandbox) return deny(403, 'FORBIDDEN_ROLE', 'SANDBOX_ONLY');
  }
  if (rule.scope === 'own' && resource.citizenId !== undefined && resource.citizenId !== actor.citizenId) {
    return deny(404, 'NOT_FOUND', 'OWNERSHIP_MISMATCH');
  }

  // 3. helper grant
  if (rule.scope === 'grant') {
    if (!resource.citizenId || !(await deps.hasLiveGrant(actor.id, resource.citizenId))) {
      return deny(403, 'GRANT_REQUIRED', 'NO_LIVE_GRANT');
    }
  }

  // 4. consent for personal data
  if (rule.consent && resource.citizenId) {
    if (!actor.tenantId || !(await deps.hasConsent(resource.citizenId, 'tenant', actor.tenantId, rule.consent))) {
      return deny(403, 'CONSENT_WITHDRAWN', `NO_ACTIVE_CONSENT:${rule.consent.purpose}:${rule.consent.category}`);
    }
  }

  return { allow: true, mask: rule.mask, view: rule.view };
}
