/**
 * NOT-1..4: notifications in Urdu and English from templates with variables. Channels are in-app, mock SMS and
 * voice note only (no WhatsApp, no email, no real SMS). Citizen messages never contain links and never ask for
 * money, PINs or codes; voice messages open by naming the citizen's trust picture.
 */
import { and, eq } from 'drizzle-orm';
import { bannedInCitizenMessage } from '@/ai/guard';
import type { DbOrTx } from '@/db/client';
import { citizens, memberships, notifications, users } from '@/db/schema/all';
import { log } from '@/lib/log';
import { smsGateway } from './adapters';

/** the 30 trust pictures, named (CIT-8); index = trustPictureId - 1 */
export const TRUST_PICTURE_NAMES: { en: string; ur: string }[] = [
  { en: 'Moon', ur: 'چاند' }, { en: 'Tree', ur: 'درخت' }, { en: 'Goat', ur: 'بکری' }, { en: 'Sunflower', ur: 'سورج مکھی' }, { en: 'Fish', ur: 'مچھلی' },
  { en: 'Pot', ur: 'مٹکا' }, { en: 'Mosque', ur: 'مسجد' }, { en: 'Cow', ur: 'گائے' }, { en: 'Wheat', ur: 'گندم' }, { en: 'Parrot', ur: 'طوطا' },
  { en: 'Lemon', ur: 'لیموں' }, { en: 'Camel', ur: 'اونٹ' }, { en: 'Boat', ur: 'کشتی' }, { en: 'Flower', ur: 'پھول' }, { en: 'Rooster', ur: 'مرغا' },
  { en: 'Watermelon', ur: 'تربوز' }, { en: 'Palm', ur: 'کھجور کا درخت' }, { en: 'Bell', ur: 'گھنٹی' }, { en: 'Sheep', ur: 'بھیڑ' }, { en: 'Mango', ur: 'آم' },
  { en: 'Lamp', ur: 'دیا' }, { en: 'Peacock', ur: 'مور' }, { en: 'Apple', ur: 'سیب' }, { en: 'Turtle', ur: 'کچھوا' }, { en: 'Rainbow', ur: 'قوس قزح' },
  { en: 'Mountain', ur: 'پہاڑ' }, { en: 'Basket', ur: 'ٹوکری' }, { en: 'Bee', ur: 'شہد کی مکھی' }, { en: 'Tulip', ur: 'گل لالہ' }, { en: 'Star', ur: 'ستارہ' },
];
export const trustName = (id: number | null | undefined) => (id && id >= 1 && id <= 30 ? TRUST_PICTURE_NAMES[id - 1]! : { en: '', ur: '' });

type Vars = Record<string, string | number>;
type Template = { en: string; ur: string; channels: ('in_app' | 'sms' | 'voice')[]; voice?: string[] };

const NO_MONEY_EN = 'Nobody will ask you for money.';
const NO_MONEY_UR = 'کوئی آپ سے پیسے نہیں مانگے گا۔';

/** voice: clip keys played in order; "{trust}" is the trust-picture clip, "{amount}" is composed from digit clips */
export const TEMPLATES = {
  case_received: { en: '{trust}. Your application reached the office. ' + NO_MONEY_EN, ur: '{trust}۔ آپ کی درخواست دفتر پہنچ گئی۔ ' + NO_MONEY_UR, channels: ['in_app'], voice: ['{trust}', 'reached_office', 'no_money'] },
  proof_needed: { en: '{trust}. Please take one more clear photo of your {item}.', ur: '{trust}۔ براہ کرم اپنے {item_ur} کی ایک اور صاف تصویر لیں۔', channels: ['in_app', 'sms', 'voice'], voice: ['{trust}', 'proof_{item}'] },
  in_review: { en: '{trust}. An officer will look at your application. You will hear from us. ' + NO_MONEY_EN, ur: '{trust}۔ ایک افسر آپ کی درخواست دیکھے گا۔ ہم آپ کو بتائیں گے۔ ' + NO_MONEY_UR, channels: ['in_app', 'voice'], voice: ['{trust}', 'status_in_review', 'no_money'] },
  approved: { en: '{trust}. Your application is approved. You will receive Rs {amount}. ' + NO_MONEY_EN, ur: '{trust}۔ آپ کی درخواست منظور ہو گئی۔ آپ کو {amount} روپے ملیں گے۔ ' + NO_MONEY_UR, channels: ['in_app', 'sms', 'voice'], voice: ['{trust}', 'status_approved', '{amount}', 'no_money'] },
  rejected: { en: '{trust}. Your application was not approved: {reason}. You can complain from the app.', ur: '{trust}۔ آپ کی درخواست منظور نہیں ہوئی: {reason_ur}۔ آپ ایپ سے شکایت کر سکتی ہیں۔', channels: ['in_app', 'sms', 'voice'], voice: ['{trust}', 'status_rejected', 'how_to_appeal'] },
  paused_consent: { en: '{trust}. Your application is paused because you stopped sharing.', ur: '{trust}۔ آپ نے معلومات دینا بند کیا، اس لیے درخواست رک گئی ہے۔', channels: ['in_app', 'voice'], voice: ['{trust}', 'status_paused'] },
  payment_sent: { en: '{trust}. Rs {amount} has been sent to your wallet ending {last4}. Check that you received all of it. ' + NO_MONEY_EN, ur: '{trust}۔ {amount} روپے آپ کے والیٹ (آخری ہندسے {last4}) میں بھیج دیے گئے۔ دیکھیں کہ پوری رقم ملی۔ ' + NO_MONEY_UR, channels: ['in_app', 'sms', 'voice'], voice: ['{trust}', 'payment_sent', '{amount}', 'receipt_check', 'no_money'] },
  frozen: { en: '{trust}. Your application is on hold while an officer checks something. ' + NO_MONEY_EN, ur: '{trust}۔ ایک افسر کچھ جانچ رہا ہے، اس لیے درخواست رکی ہوئی ہے۔ ' + NO_MONEY_UR, channels: ['in_app', 'voice'], voice: ['{trust}', 'status_frozen', 'no_money'] },
  payout_change_notice: { en: 'Saaya: your money will go to a new number ending {last4}. Press 9 if this isn\'t you.', ur: 'سایہ: آپ کی رقم نئے نمبر (آخری ہندسے {last4}) پر جائے گی۔ اگر یہ آپ نہیں ہیں تو 9 دبائیں۔', channels: ['sms', 'voice'], voice: ['payout_notice', 'press_9'] },
  payout_change_done: { en: '{trust}. Your payout number has been changed to the number ending {last4}.', ur: '{trust}۔ آپ کا ادائیگی نمبر بدل گیا (آخری ہندسے {last4})۔', channels: ['in_app', 'sms'], voice: ['{trust}', 'payout_changed'] },
  payout_change_blocked: { en: '{trust}. The payout number change was stopped. An officer will call you.', ur: '{trust}۔ ادائیگی نمبر کی تبدیلی روک دی گئی۔ ایک افسر آپ کو فون کرے گا۔', channels: ['in_app', 'sms', 'voice'], voice: ['{trust}', 'payout_blocked'] },
  complaint_received: { en: '{trust}. We received your complaint. An officer will look at it.', ur: '{trust}۔ آپ کی شکایت مل گئی۔ ایک افسر اسے دیکھے گا۔', channels: ['in_app', 'voice'], voice: ['{trust}', 'complaint_received'] },
  complaint_resolved: { en: '{trust}. Your complaint was looked at: {outcome}.', ur: '{trust}۔ آپ کی شکایت دیکھ لی گئی: {outcome_ur}۔', channels: ['in_app', 'sms', 'voice'], voice: ['{trust}', 'complaint_{outcome_code}'] },
  correction_done: { en: '{trust}. Your correction request was {outcome}.', ur: '{trust}۔ آپ کی درستگی کی درخواست {outcome_ur}۔', channels: ['in_app', 'voice'], voice: ['{trust}', 'correction_{outcome_code}'] },
  officer_alert: { en: 'Alert: {text}', ur: 'انتباہ: {text}', channels: ['in_app'] },
  scam_alert: { en: 'Saaya warning for {district}: fake messages are asking for a fee. Saaya never charges fees. Do not send money.', ur: '{district} کے لیے سایہ کی تنبیہ: جعلی پیغامات فیس مانگ رہے ہیں۔ سایہ کبھی فیس نہیں لیتا۔ پیسے نہ بھیجیں۔', channels: ['in_app', 'sms', 'voice'], voice: ['scam_alert', 'no_money'] },
} satisfies Record<string, Template>;
export type TemplateKey = keyof typeof TEMPLATES;

export function render(key: TemplateKey, vars: Vars, lang: 'en' | 'ur') {
  return TEMPLATES[key][lang].replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : ''));
}

/**
 * Writes the in-app row and sends the SMS / voice note through the mock gateway (NOT-3: delivery status tracked).
 * Called after commit for side effects; a failed SMS never blocks anything (in-app always succeeds).
 */
export async function notifyCitizen(db: DbOrTx, p: { tenantId: string | null; citizenId: string; key: TemplateKey; vars?: Vars; toPhone?: string }) {
  const [c] = await db.select({ trust: citizens.trustPictureId, phone: users.phone, locale: users.locale }).from(citizens).leftJoin(users, eq(users.id, citizens.userId)).where(eq(citizens.id, p.citizenId)).limit(1);
  if (!c) return;
  const tn = trustName(c.trust);
  const vars: Vars = { trust: tn.ur ? tn.en : '', ...(p.vars ?? {}) };
  const varsUr: Vars = { ...vars, trust: tn.ur };
  const en = render(p.key, vars, 'en');
  const ur = render(p.key, varsUr, 'ur');
  const banned = bannedInCitizenMessage(en);
  if (banned.length) { log('error', 'notification blocked by guard', { key: p.key, banned }); return; }
  const t = TEMPLATES[p.key] as Template;
  const phone = p.toPhone ?? c.phone ?? null;
  for (const channel of t.channels) {
    if (channel !== 'in_app' && !phone) continue;
    const [row] = await db.insert(notifications).values({ tenantId: p.tenantId, citizenId: p.citizenId, channel, templateKey: p.key, variables: { ...vars, voice: t.voice ?? [] } }).returning({ id: notifications.id });
    if (channel === 'in_app') { await db.update(notifications).set({ status: 'sent', sentAt: new Date(), attempts: 1 }).where(eq(notifications.id, row!.id)); continue; }
    try {
      if (channel === 'sms') await smsGateway.send(phone!, c.locale === 'en' ? en : `${ur}\n${en}`, 'notification', 'SAAYA');
      else await smsGateway.ivrCall(phone!, `${ur} / ${en}`);
      await db.update(notifications).set({ status: 'sent', sentAt: new Date(), attempts: 1 }).where(eq(notifications.id, row!.id));
    } catch (e) {
      await db.update(notifications).set({ status: 'failed', attempts: 1 }).where(eq(notifications.id, row!.id));
      log('warn', 'notification channel failed', { channel, key: p.key, error: String(e) });
    }
  }
}

/** in-app alert for every officer of a tenant (helper anomalies, payment holds, pipeline errors) */
export async function alertOfficers(db: DbOrTx, tenantId: string, text: string, ref: Record<string, string>) {
  const officers = await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'officer')));
  for (const o of officers) {
    await db.insert(notifications).values({ tenantId, userId: o.userId, channel: 'in_app', templateKey: 'officer_alert', variables: { text, ...ref }, status: 'sent', sentAt: new Date(), attempts: 1 });
  }
}
