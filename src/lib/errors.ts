/** PRD §27.1 error codes, RFC 9457 problem details. */
export const ERROR_CODES = {
  VALIDATION_FAILED: { status: 422, title: 'Input broke a schema rule' },
  BAD_REQUEST: { status: 400, title: 'Malformed request' },
  UNAUTHENTICATED: { status: 401, title: 'No valid session or key' },
  FORBIDDEN_ROLE: { status: 403, title: 'Your role cannot do this' },
  NOT_FOUND: { status: 404, title: 'Not found' },
  GRANT_REQUIRED: { status: 403, title: 'The family has not unlocked this case' },
  CONSENT_WITHDRAWN: { status: 403, title: 'Access withdrawn by the citizen' },
  SCOPE_MISSING: { status: 403, title: 'API key lacks the scope' },
  PIN_LOCKED: { status: 423, title: 'PIN locked after too many wrong tries' },
  PIN_INVALID: { status: 401, title: 'Wrong PIN' },
  RATE_LIMITED: { status: 429, title: 'Too many requests' },
  IDEMPOTENCY_KEY_REUSED: { status: 422, title: 'Idempotency key reused with a different body' },
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, title: 'Idempotency-Key header required' },
  IDEMPOTENCY_IN_PROGRESS: { status: 409, title: 'A request with this key is still running' },
  STALE_VERSION: { status: 409, title: 'Someone else changed this first' },
  CASE_STATE: { status: 409, title: 'The case is not in a state that allows this' },
  REASON_REQUIRED: { status: 422, title: 'A reason code is required' },
  DEPENDENCY_UNAVAILABLE: { status: 503, title: 'A required service is down' },
  PAYLOAD_TOO_LARGE: { status: 413, title: 'File too big' },
  UNSUPPORTED_MEDIA: { status: 415, title: 'Unsupported file type' },
  NOT_ON_WHATSAPP: { status: 422, title: 'This number is not on WhatsApp' },
  DEMO_DISABLED: { status: 404, title: 'Not found' },
  INTERNAL: { status: 500, title: 'Unexpected error' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export const PROBLEM_BASE = 'https://amanat.example/problems/';
const slug = (code: string) => code.toLowerCase().replace(/_/g, '-');

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string;
  readonly extra: Record<string, unknown>;
  /** the real reason, recorded only in the audit log (e.g. TENANT_MISMATCH behind a NOT_FOUND) */
  readonly auditReason?: string;
  readonly headers: Record<string, string>;

  constructor(code: ErrorCode, detail?: string, opts: { extra?: Record<string, unknown>; auditReason?: string; headers?: Record<string, string> } = {}) {
    super(detail ?? ERROR_CODES[code].title);
    this.code = code;
    this.status = ERROR_CODES[code].status;
    this.detail = detail ?? ERROR_CODES[code].title;
    this.extra = opts.extra ?? {};
    this.auditReason = opts.auditReason;
    this.headers = opts.headers ?? {};
  }
}

export type Problem = { type: string; title: string; status: number; detail: string; code: ErrorCode; requestId: string } & Record<string, unknown>;

export function toProblem(err: ApiError, requestId: string): Problem {
  return {
    type: PROBLEM_BASE + slug(err.code),
    title: ERROR_CODES[err.code].title,
    status: err.status,
    detail: err.detail,
    code: err.code,
    requestId,
    ...err.extra,
  };
}

/** NOT_FOUND for an unknown id and for another tenant's resource must be byte-identical. */
export const notFound = (auditReason?: string) => new ApiError('NOT_FOUND', 'The requested resource was not found.', { auditReason });
