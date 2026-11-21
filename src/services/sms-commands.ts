import 'server-only';
/**
 * OFF-8 (P2, SIMULATED): a citizen with no data texts "STATUS" (or "حالت") to the mock short code 8171 and gets her
 * latest case state back as an SMS on the mock phone. The reply opens with her trust picture (anti-phishing),
 * contains no link, no amount and no personal data, and never asks for anything.
 */
import { desc, eq } from 'drizzle-orm';
import { bannedInCitizenMessage } from '@/ai/guard';
import type { DbOrTx } from '@/db/client';
import { cases, citizens, users } from '@/db/schema/all';
import { mockSmsMessages } from '@/db/schema/mock';
import { writeAudit } from '@/lib/audit';
import { trustName } from './notify';
import { citizenFacingStatus } from './duress';

export const SHORT_CODE = '8171';

const STATE: Record<string, { en: string; ur: string }> = {
  draft: { en: 'Your application is not sent yet. Open the app to finish it.', ur: 'آپ کی درخواست ابھی نہیں بھیجی گئی۔ مکمل کرنے کے لیے ایپ کھولیں۔' },
  submitted: { en: 'Your application reached the office.', ur: 'آپ کی درخواست دفتر پہنچ گئی۔' },
  processing: { en: 'Your application reached the office and is being checked.', ur: 'آپ کی درخواست دفتر پہنچ گئی ہے اور جانچی جا رہی ہے۔' },
  needs_proof: { en: 'The office needs one more photo. Open the app.', ur: 'دفتر کو ایک اور تصویر چاہیے۔ ایپ کھولیں۔' },
  in_review: { en: 'An officer is looking at your application.', ur: 'ایک افسر آپ کی درخواست دیکھ رہا ہے۔' },
  approved_on_hold: { en: 'Your application is approved. Payment is scheduled.', ur: 'آپ کی درخواست منظور ہو گئی۔ ادائیگی طے ہے۔' },
  approved: { en: 'Your application is approved. Payment is scheduled.', ur: 'آپ کی درخواست منظور ہو گئی۔ ادائیگی طے ہے۔' },
  rejected: { en: 'Your application was not approved. You can complain from the app.', ur: 'آپ کی درخواست منظور نہیں ہوئی۔ آپ ایپ سے شکایت کر سکتی ہیں۔' },
  paid: { en: 'Payment sent. Check that you received all of it.', ur: 'ادائیگی بھیج دی گئی۔ دیکھیں کہ پوری رقم ملی۔' },
  confirmed: { en: 'You confirmed the payment. Thank you.', ur: 'آپ نے رقم ملنے کی تصدیق کی۔ شکریہ۔' },
  disputed: { en: 'Your payment complaint is with an officer.', ur: 'آپ کی ادائیگی کی شکایت افسر کے پاس ہے۔' },
  paused_for_consent: { en: 'Your application is paused because you stopped sharing.', ur: 'آپ نے معلومات دینا بند کیا، اس لیے درخواست رکی ہوئی ہے۔' },
  frozen: { en: 'Your application is on hold while an officer checks something.', ur: 'ایک افسر کچھ جانچ رہا ہے، اس لیے درخواست رکی ہوئی ہے۔' },
  closed: { en: 'Your application is closed.', ur: 'آپ کی درخواست بند ہو گئی ہے۔' },
};
const NONE = { en: 'There is no application for this number.', ur: 'اس نمبر پر کوئی درخواست نہیں ہے۔' };
const HELP = { en: `Text STATUS to ${SHORT_CODE} to hear your application state.`, ur: `اپنی درخواست کی حالت جاننے کے لیے ${SHORT_CODE} پر STATUS لکھ کر بھیجیں۔` };
const NO_MONEY = { en: 'Nobody will ask you for money.', ur: 'کوئی آپ سے پیسے نہیں مانگے گا۔' };

export const isStatusCommand = (body: string) => /^\s*(status|حالت|halat)\s*$/i.test(body);

export async function handleInboundSms(db: DbOrTx, from: string, body: string) {
  let reply: { en: string; ur: string } = HELP;
  let trust = { en: '', ur: '' };
  let found: { caseId: string; tenantId: string; citizenId: string; status: string } | null = null;
  if (isStatusCommand(body)) {
    const [c] = await db.select({ citizenId: citizens.id, trust: citizens.trustPictureId }).from(users).innerJoin(citizens, eq(citizens.userId, users.id)).where(eq(users.phone, from)).limit(1);
    if (!c) reply = NONE;
    else {
      trust = trustName(c.trust);
      const [k] = await db.select({ id: cases.id, tenantId: cases.tenantId, status: cases.status, frozenReason: cases.frozenReason }).from(cases).where(eq(cases.citizenId, c.citizenId)).orderBy(desc(cases.updatedAt)).limit(1);
      if (!k) reply = NONE;
      else { const shown = citizenFacingStatus(k.status, k.frozenReason); reply = STATE[shown] ?? NONE; found = { caseId: k.id, tenantId: k.tenantId, citizenId: c.citizenId, status: shown }; }
    }
  }
  const en = [trust.en, reply.en, NO_MONEY.en].filter(Boolean).join('. ').replace(/\.\./g, '.');
  const ur = [trust.ur, reply.ur, NO_MONEY.ur].filter(Boolean).join('۔ ').replace(/۔۔/g, '۔');
  if (bannedInCitizenMessage(en).length) throw new Error('status reply blocked by guard');
  const text = `${ur}\n${en}`;
  const [m] = await db.insert(mockSmsMessages).values({ toPhone: from, fromSender: `SAAYA ${SHORT_CODE}`, body: text, kind: 'notification' }).returning({ id: mockSmsMessages.id });
  if (found) {
    await writeAudit(db, { actorType: 'system', actorId: 'sms.status', tenantId: found.tenantId, subjectCitizenId: found.citizenId, action: 'case.status.sms', resourceType: 'case', resourceId: found.caseId, outcome: 'allowed', details: { status: found.status } });
  }
  return { replied: true, messageId: m!.id, status: found?.status ?? null };
}
