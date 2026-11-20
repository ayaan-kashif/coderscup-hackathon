/**
 * ID-1 name normaliser. Pure, and mirrored line for line in ml/common.py so offline weight estimation
 * sees exactly the same comparison levels as the runtime. Change both together (a parity test enforces it).
 */

/** Whole-word Urdu → Roman forms for common names and honorifics (checked before letter-by-letter fallback). */
const URDU_WORDS: Record<string, string> = {
  'محمد': 'muhammad', 'مُحمد': 'muhammad', 'فاطمہ': 'fatima', 'فاطمة': 'fatima', 'زرینہ': 'zarina', 'بی': 'bi', 'بیبی': 'bibi',
  'بیگم': 'begum', 'اسلم': 'aslam', 'علی': 'ali', 'احمد': 'ahmad', 'خان': 'khan', 'رخسانہ': 'rukhsana', 'نسرین': 'nasreen',
  'شازیہ': 'shazia', 'عائشہ': 'ayesha', 'سید': 'syed', 'مسماۃ': 'mst', 'مسمات': 'mst', 'حسین': 'hussain', 'اکرم': 'akram',
  'رضیہ': 'razia', 'صغری': 'sughra', 'کلثوم': 'kulsoom', 'نذیر': 'nazir', 'بشیر': 'bashir', 'رشید': 'rashid', 'امینہ': 'amina',
  'حلیمہ': 'halima', 'سکینہ': 'sakina', 'زینب': 'zainab', 'عبدل': 'abdul', 'عبد': 'abdul', 'غلام': 'ghulam', 'اللہ': 'allah',
  'یوسف': 'yousaf', 'اقبال': 'iqbal', 'جمیلہ': 'jamila', 'پروین': 'parveen', 'شمیم': 'shamim', 'نور': 'noor', 'بانو': 'bano',
};

/** Letter-by-letter fallback for Urdu script (approximate, used only for words not in the table). */
const URDU_LETTERS: Record<string, string> = {
  'ا': 'a', 'آ': 'a', 'ب': 'b', 'پ': 'p', 'ت': 't', 'ٹ': 't', 'ث': 's', 'ج': 'j', 'چ': 'ch', 'ح': 'h', 'خ': 'kh', 'د': 'd',
  'ڈ': 'd', 'ذ': 'z', 'ر': 'r', 'ڑ': 'r', 'ز': 'z', 'ژ': 'zh', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'z', 'ط': 't', 'ظ': 'z',
  'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ک': 'k', 'ك': 'k', 'گ': 'g', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ں': 'n', 'و': 'o',
  'ہ': 'a', 'ھ': 'h', 'ة': 'a', 'ۃ': 'a', 'ء': '', 'ی': 'i', 'ي': 'i', 'ے': 'e', 'ئ': 'i', 'ؤ': 'o',
};

const MUHAMMAD = new Set(['muhammad', 'mohammad', 'mohammed', 'muhammed', 'mohamad', 'muhamad', 'mohd', 'muhd', 'md', 'm', 'mhd', 'mohamed']);
/** ID-1 honorifics: dropped on both sides so "Mst. Zarina Bibi" and "ZARINA BIBI" compare equal. */
const HONORIFICS = new Set(['mst', 'mrs', 'mr', 'bibi', 'begum', 'syed', 'sayed', 'sayyed', 'syeda', 'bi', 'mai', 'mussammat', 'musammat']);

const hasUrdu = (s: string) => /[؀-ۿ]/.test(s);

function transliterateWord(w: string): string {
  if (URDU_WORDS[w]) return URDU_WORDS[w]!;
  let out = '';
  for (const ch of w) out += URDU_LETTERS[ch] ?? '';
  return out;
}

export type NormalisedName = { normalised: string; tokens: string[]; phonetic: string };

export function normaliseName(raw: string): NormalisedName {
  let s = raw.normalize('NFC').trim();
  if (hasUrdu(s)) {
    // remove Urdu diacritics, then transliterate word by word
    s = s.replace(/[ً-ٰٟ]/g, '');
    s = s.split(/\s+/).map(transliterateWord).join(' ');
  }
  s = s.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  let tokens = s ? s.split(' ') : [];
  // "bi bi" written as two words
  const joined: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === 'bi' && tokens[i + 1] === 'bi') { joined.push('bibi'); i++; } else joined.push(tokens[i]!);
  }
  tokens = joined.map((t) => (MUHAMMAD.has(t) ? 'muhammad' : t)).filter((t) => !HONORIFICS.has(t));
  const normalised = tokens.join(' ');
  return { normalised, tokens, phonetic: tokens.map(phoneticKey).join(' ') };
}

/** A small consonant-skeleton key for South Asian names in Roman script. */
export function phoneticKey(token: string): string {
  let t = token.toLowerCase();
  t = t.replace(/ph/g, 'f').replace(/kh/g, 'k').replace(/gh/g, 'g').replace(/sh/g, 's').replace(/ch/g, 'c')
    .replace(/th/g, 't').replace(/dh/g, 'd').replace(/q/g, 'k').replace(/w/g, 'v').replace(/z/g, 's').replace(/y/g, 'i');
  if (!t) return '';
  const first = t[0]!;
  let rest = t.slice(1).replace(/[aeiouh]/g, '');
  rest = rest.replace(/(.)\1+/g, '$1');
  return (first + rest).slice(0, 6);
}

/** Jaro–Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aM = new Array<boolean>(a.length).fill(false);
  const bM = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bM[j] || a[i] !== b[j]) continue;
      aM[i] = true; bM[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  let trans = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) trans++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - trans / 2) / m) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) { if (a[i] === b[i]) prefix++; else break; }
  return jaro + prefix * 0.1 * (1 - jaro);
}
