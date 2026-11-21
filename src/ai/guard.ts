/**
 * §12.2 card 7 — input and output guardrails that run without any model.
 */

/** DOC-6: instruction-like text in a document or message (English, Roman Urdu, Urdu). */
export const INJECTION_PATTERNS: RegExp[] = [
  /\bignore (all |any )?(previous|prior|above) (instructions|rules)\b/i,
  /\b(approve|accept|pass) (this|the) (claim|case|application)\b/i,
  /\bnote to (the )?(reviewer|officer|ai|system)\b/i,
  /\b(system|assistant)\s*:/i,
  /\bset (the )?(status|decision|outcome) to\b/i,
  /\bdo not (flag|escalate|review)\b/i,
  /\bmanzoor kar(o|ein|dein)\b/i,
  /منظور کر/,
];

export function injectionHits(text: string): string[] {
  return INJECTION_PATTERNS.filter((p) => p.test(text)).map((p) => p.source);
}

/** NOT-1 / NOT-4: citizen messages never contain links and never ask for money, PINs or codes. */
export function bannedInCitizenMessage(text: string): string[] {
  const p: string[] = [];
  if (/https?:\/\/|www\.|\.(com|pk|net|org)\b/i.test(text)) p.push('link');
  if (/\b(send|pay|transfer)\b.{0,20}\b(rs|rupees|money|fee)\b/i.test(text)) p.push('asks_for_money');
  if (/\b(share|tell|send)\b.{0,20}\b(pin|code|otp|password)\b/i.test(text)) p.push('asks_for_code');
  return p;
}
