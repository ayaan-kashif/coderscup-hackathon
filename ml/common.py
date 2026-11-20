"""Shared helpers for the offline generator and trainer.

The name normaliser, phonetic key, Jaro-Winkler and comparison levels mirror
src/domain/matcher/normalise.ts and fellegi-sunter.ts line for line. A Vitest parity
test (tests/unit/matcher-parity.test.ts) recomputes the levels stored in D3 with the
TypeScript code and fails if the two ever disagree. Change both together.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata

URDU_WORDS = {
    'محمد': 'muhammad', 'مُحمد': 'muhammad', 'فاطمہ': 'fatima', 'فاطمة': 'fatima', 'زرینہ': 'zarina', 'بی': 'bi', 'بیبی': 'bibi',
    'بیگم': 'begum', 'اسلم': 'aslam', 'علی': 'ali', 'احمد': 'ahmad', 'خان': 'khan', 'رخسانہ': 'rukhsana', 'نسرین': 'nasreen',
    'شازیہ': 'shazia', 'عائشہ': 'ayesha', 'سید': 'syed', 'مسماۃ': 'mst', 'مسمات': 'mst', 'حسین': 'hussain', 'اکرم': 'akram',
    'رضیہ': 'razia', 'صغری': 'sughra', 'کلثوم': 'kulsoom', 'نذیر': 'nazir', 'بشیر': 'bashir', 'رشید': 'rashid', 'امینہ': 'amina',
    'حلیمہ': 'halima', 'سکینہ': 'sakina', 'زینب': 'zainab', 'عبدل': 'abdul', 'عبد': 'abdul', 'غلام': 'ghulam', 'اللہ': 'allah',
    'یوسف': 'yousaf', 'اقبال': 'iqbal', 'جمیلہ': 'jamila', 'پروین': 'parveen', 'شمیم': 'shamim', 'نور': 'noor', 'بانو': 'bano',
}

URDU_LETTERS = {
    'ا': 'a', 'آ': 'a', 'ب': 'b', 'پ': 'p', 'ت': 't', 'ٹ': 't', 'ث': 's', 'ج': 'j', 'چ': 'ch', 'ح': 'h', 'خ': 'kh', 'د': 'd',
    'ڈ': 'd', 'ذ': 'z', 'ر': 'r', 'ڑ': 'r', 'ز': 'z', 'ژ': 'zh', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'z', 'ط': 't', 'ظ': 'z',
    'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ک': 'k', 'ك': 'k', 'گ': 'g', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ں': 'n', 'و': 'o',
    'ہ': 'a', 'ھ': 'h', 'ة': 'a', 'ۃ': 'a', 'ء': '', 'ی': 'i', 'ي': 'i', 'ے': 'e', 'ئ': 'i', 'ؤ': 'o',
}

# reverse table for generating Urdu-script variants (first spelling wins)
ROMAN_TO_URDU: dict[str, str] = {}
for _ur, _ro in URDU_WORDS.items():
    ROMAN_TO_URDU.setdefault(_ro, _ur)

MUHAMMAD = {'muhammad', 'mohammad', 'mohammed', 'muhammed', 'mohamad', 'muhamad', 'mohd', 'muhd', 'md', 'm', 'mhd', 'mohamed'}
HONORIFICS = {'mst', 'mrs', 'mr', 'bibi', 'begum', 'syed', 'sayed', 'sayyed', 'syeda', 'bi', 'mai', 'mussammat', 'musammat'}

_URDU_RE = re.compile('[؀-ۿ]')
_DIACRITICS_RE = re.compile('[ً-ٰٟ]')


def _translit_word(w: str) -> str:
    if w in URDU_WORDS:
        return URDU_WORDS[w]
    return ''.join(URDU_LETTERS.get(ch, '') for ch in w)


def phonetic_key(token: str) -> str:
    t = token.lower()
    for a, b in (('ph', 'f'), ('kh', 'k'), ('gh', 'g'), ('sh', 's'), ('ch', 'c'), ('th', 't'), ('dh', 'd')):
        t = t.replace(a, b)
    t = t.replace('q', 'k').replace('w', 'v').replace('z', 's').replace('y', 'i')
    if not t:
        return ''
    first = t[0]
    rest = re.sub('[aeiouh]', '', t[1:])
    rest = re.sub(r'(.)\1+', r'\1', rest)
    return (first + rest)[:6]


def normalise_name(raw: str) -> dict:
    s = unicodedata.normalize('NFC', raw).strip()
    if _URDU_RE.search(s):
        s = _DIACRITICS_RE.sub('', s)
        s = ' '.join(_translit_word(w) for w in s.split())
    s = re.sub(r'[^a-z\s]', ' ', s.lower())
    s = re.sub(r'\s+', ' ', s).strip()
    tokens = s.split(' ') if s else []
    joined: list[str] = []
    i = 0
    while i < len(tokens):
        if tokens[i] == 'bi' and i + 1 < len(tokens) and tokens[i + 1] == 'bi':
            joined.append('bibi')
            i += 2
        else:
            joined.append(tokens[i])
            i += 1
    tokens = [('muhammad' if t in MUHAMMAD else t) for t in joined]
    tokens = [t for t in tokens if t not in HONORIFICS]
    return {'normalised': ' '.join(tokens), 'tokens': tokens, 'phonetic': ' '.join(phonetic_key(t) for t in tokens)}


def jaro_winkler(a: str, b: str) -> float:
    if a == b:
        return 1.0 if a else 0.0
    if not a or not b:
        return 0.0
    rng = max(0, max(len(a), len(b)) // 2 - 1)
    am = [False] * len(a)
    bm = [False] * len(b)
    matches = 0
    for i in range(len(a)):
        lo = max(0, i - rng)
        hi = min(i + rng + 1, len(b))
        for j in range(lo, hi):
            if bm[j] or a[i] != b[j]:
                continue
            am[i] = True
            bm[j] = True
            matches += 1
            break
    if not matches:
        return 0.0
    k = 0
    trans = 0
    for i in range(len(a)):
        if not am[i]:
            continue
        while not bm[k]:
            k += 1
        if a[i] != b[k]:
            trans += 1
        k += 1
    m = matches
    jaro = (m / len(a) + m / len(b) + (m - trans / 2) / m) / 3
    prefix = 0
    for i in range(min(4, len(a), len(b))):
        if a[i] == b[i]:
            prefix += 1
        else:
            break
    return jaro + prefix * 0.1 * (1 - jaro)


FIELDS = ['name', 'relationName', 'dob', 'cnic', 'district', 'gender']
LEVELS = {
    'name': ['exact', 'phonetic', 'close', 'different'],
    'relationName': ['exact', 'phonetic', 'close', 'different'],
    'dob': ['exact', 'swapped', 'year', 'different'],
    'cnic': ['exact', 'near', 'different'],
    'district': ['exact', 'different'],
    'gender': ['exact', 'different'],
}


def name_level(a, b) -> str:
    if not a or not b:
        return 'missing'
    x = normalise_name(a)
    y = normalise_name(b)
    if not x['normalised'] or not y['normalised']:
        return 'missing'
    if x['normalised'] == y['normalised']:
        return 'exact'
    if x['phonetic'] == y['phonetic']:
        return 'phonetic'
    if jaro_winkler(x['normalised'], y['normalised']) >= 0.9:
        return 'close'
    return 'different'


def dob_level(a, b) -> str:
    if not a or not b:
        return 'missing'
    if a == b:
        return 'exact'
    ya, ma, da = (a.split('-') + ['', '', ''])[:3]
    yb, mb, db = (b.split('-') + ['', '', ''])[:3]
    if ya == yb and ma == db and da == mb:
        return 'swapped'
    if ya and yb and abs(int(ya) - int(yb)) <= 1:
        return 'year'
    return 'different'


def cnic_level(a, b) -> str:
    if not a or not b:
        return 'missing'
    x = re.sub(r'\D', '', a)
    y = re.sub(r'\D', '', b)
    if x == y:
        return 'exact'
    if len(x) == len(y) and sum(1 for i in range(len(x)) if x[i] != y[i]) == 1:
        return 'near'
    return 'different'


def simple_level(a, b) -> str:
    if not a or not b:
        return 'missing'
    return 'exact' if a == b else 'different'


def compare_fields(a: dict, b: dict) -> dict:
    return {
        'name': name_level(a.get('name'), b.get('name')),
        'relationName': name_level(a.get('relationName'), b.get('relationName')),
        'dob': dob_level(a.get('dob'), b.get('dob')),
        'cnic': cnic_level(a.get('cnic'), b.get('cnic')),
        'district': simple_level(a.get('district'), b.get('district')),
        'gender': simple_level(a.get('gender'), b.get('gender')),
    }


def round6(x: float) -> float:
    """JS Math.round(x * 1e6) / 1e6 (half up), not Python's half-even round()."""
    return math.floor(x * 1e6 + 0.5) / 1e6


def score_pair(a: dict, b: dict, weights: dict) -> float:
    levels = compare_fields(a, b)
    total = 0.0
    for f in FIELDS:
        lv = levels[f]
        if lv == 'missing':
            continue
        p = weights['fields'][f].get(lv)
        if not p:
            continue
        total += round6(math.log2(p['m'] / p['u']))
    return round6(total)


def canonical_json(v) -> str:
    """Same bytes as src/domain/canonical.ts for the ASCII payloads we sign."""
    return json.dumps(v, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def write_json(path, data) -> None:
    import pathlib
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=False) + '\n', encoding='utf-8', newline='\n')
