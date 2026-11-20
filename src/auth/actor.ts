/** PRD §13.2 */
export type Role = 'citizen' | 'helper' | 'officer' | 'admin' | 'auditor';
export const ROLES: readonly Role[] = ['citizen', 'helper', 'officer', 'admin', 'auditor'];

export type Actor = {
  kind: 'user' | 'api_key' | 'system' | 'agent';
  id: string;
  /** null for API keys and system actors: they are governed by scopes and tool allowlists instead */
  role: Role | null;
  tenantId?: string;          // staff and API keys
  citizenId?: string;         // citizens
  scopes?: string[];          // API keys
  isSenior?: boolean;
  /** citizens: 'otp' after the phone code, 'full' after the PIN */
  stage?: 'otp' | 'full';
  via?: 'bearer' | 'cookie' | 'api_key';
};

export const SYSTEM_ACTOR: Actor = { kind: 'system', id: 'system', role: null };

/** audit_events.actor_type for an actor */
export const auditActorType = (a: Actor | null) =>
  !a ? 'user' as const : a.kind === 'api_key' ? 'api_key' as const : a.kind === 'system' ? 'system' as const : a.kind === 'agent' ? 'agent' as const : 'user' as const;
