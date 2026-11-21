/**
 * DOC-2: signed QR format AMQR1.<base64url canonical JSON payload>.<base64url Ed25519 signature>, issued by the
 * mock document issuer (keys in mock.issuer_keys, served SIMULATED at /api/mock/issuer/keys).
 */
import { createPublicKey, verify } from 'node:crypto';

export type QrPayload = {
  doc_type: 'cnic' | 'death_certificate';
  doc_no: string;
  cnic: string;
  name: string;
  relation_name: string;
  dob?: string;
  date_of_death?: string;
  issued_at?: string;
  kid: string;
};

const b64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
// RFC 8410 SubjectPublicKeyInfo prefix for a raw Ed25519 key
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function parseQr(qr: string): { payload: QrPayload; body: Buffer; sig: Buffer } | null {
  const m = /^AMQR1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(qr.trim());
  if (!m) return null;
  try {
    const body = b64u(m[1]!);
    const payload = JSON.parse(body.toString('utf8')) as QrPayload;
    if (typeof payload !== 'object' || !payload.kid || !payload.doc_type) return null;
    return { payload, body, sig: b64u(m[2]!) };
  } catch { return null; }
}

export function verifyQrSignature(parsed: { payload: QrPayload; body: Buffer; sig: Buffer }, keys: { kid: string; publicKey: string; status: string }[]) {
  const key = keys.find((k) => k.kid === parsed.payload.kid && k.status === 'active');
  if (!key) return false;
  try {
    const pub = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, b64u(key.publicKey)]), format: 'der', type: 'spki' });
    return verify(null, parsed.body, pub, parsed.sig);
  } catch { return false; }
}
