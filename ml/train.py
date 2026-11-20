"""Offline training (never on the request path).

    python ml/train.py [--check]

1. Matcher: estimates Fellegi-Sunter m/u probabilities per field and level from the D3 estimate split
   (supervised counting with Laplace smoothing), picks the two thresholds, reports test metrics.
   -> data/models/matcher-v1.json
2. Evidence scorer: logistic regression on the 12 evidence features of D1 train (300), isotonic calibration on
   D1 calibration (100), metrics on the frozen D1 test split (100).
   -> data/models/scorer-v1.json

--check recomputes both artifacts and fails if they differ from the committed files.
"""
from __future__ import annotations

import argparse
import json
import math
import pathlib
import sys

import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common import FIELDS, LEVELS, compare_fields, round6, score_pair  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'

# DEC-2 / F6 step 3: evidence features of THIS case only (district scam rates are never used)
FEATURES = ['match_weight', 'qr_valid', 'qr_text_agree', 'death_record_found', 'marital_link', 'duplicate_score',
            'image_reuse', 'sharpness', 'proof_attempts', 'helper_anomaly_score', 'days_since_payout_change', 'wallet_shared']
CLIP = (0.005, 0.995)
SCORER_EXCLUDE = {'ineligible', 'ambiguous_identity'}


def r6(x):
    return round6(float(x))


def train_matcher(pairs):
    est = [p for p in pairs if p['split'] == 'estimate']
    test = [p for p in pairs if p['split'] == 'test']
    fields = {}
    for f in FIELDS:
        lv = LEVELS[f]
        counts = {'match': {l: 0 for l in lv}, 'non_match': {l: 0 for l in lv}}
        for p in est:
            level = p['levels'][f]
            # u describes RANDOM non-matching pairs (Fellegi-Sunter); the deliberately over-sampled hard negatives
            # (same name, other husband / same district) would make name agreement look like evidence AGAINST a match.
            # They stay in the estimate set for choosing thresholds and in the test set for metrics.
            if p['label'] == 'non_match' and p['variant'] != 'random':
                continue
            if level != 'missing':
                counts[p['label']][level] += 1
        nm = sum(counts['match'].values())
        nu = sum(counts['non_match'].values())
        fields[f] = {l: {'m': r6((counts['match'][l] + 1) / (nm + len(lv))), 'u': r6((counts['non_match'][l] + 1) / (nu + len(lv)))} for l in lv}
    weights = {'version': 'matcher-v1', 'fields': fields, 'thresholds': {'upperBits': 0.0, 'lowerBits': 0.0}, 'ambiguityBits': 2, 'prior': 0.1}

    scores = [(score_pair(p['a'], p['b'], weights), p['label']) for p in est]
    max_non = max(s for s, l in scores if l == 'non_match')
    min_match = min(s for s, l in scores if l == 'match')
    # ID-3: at or above upper = match, at or below lower = non-match, between = human review.
    # upper sits at least 4 bits above every non-match in the estimate set (zero false auto-matches is the target),
    # and 1.5 bits under the weakest true match when that is higher; lower sits 2 bits above the strongest non-match.
    upper = r6(max(max_non + 4.0, min_match - 1.5))
    lower = r6(min(max_non + 2.0, upper - 2.0))
    weights['thresholds'] = {'upperBits': upper, 'lowerBits': lower}

    def zone(s):
        return 'match' if s >= upper else 'non_match' if s <= lower else 'review'

    tp = fp = fn = rev = 0
    for p in test:
        z = zone(score_pair(p['a'], p['b'], weights))
        if z == 'review':
            rev += 1
        if z == 'match' and p['label'] == 'match':
            tp += 1
        elif z == 'match':
            fp += 1
        elif p['label'] == 'match':
            fn += 1
    n_match = sum(1 for p in test if p['label'] == 'match')
    weights['metrics'] = {
        'dataset': 'D3 test', 'n': len(test), 'auto_match_precision': r6(tp / (tp + fp)) if tp + fp else None,
        'recall_auto_match': r6(tp / n_match) if n_match else None, 'review_zone_rate': r6(rev / len(test)),
        'false_auto_matches': fp, 'targets': {'precision': 1.0, 'recall': 0.9, 'review_zone_rate_max': 0.1},
    }
    return weights


def case_features(c, matcher, registry_by_cnic, registry):
    """Same feature definitions the runtime pipeline computes (src/domain/scorer.ts)."""
    q = c['match_query']
    # blocking: CNIC if readable, otherwise name + district (mirrors the identity/search mock)
    if q['cnic'] and q['cnic'] in registry_by_cnic:
        cands = [registry_by_cnic[q['cnic']]]
    else:
        cands = [r for r in registry if r['gender'] == 'F' and r['districtCode'] == q['district'] and r['name'].split()[0].lower() in q['name'].lower()]
    best = -20.0
    for r in cands:
        b = {'name': r['name'], 'relationName': r['relationName'], 'dob': r['dob'], 'cnic': r['cnic'], 'district': r['districtCode'], 'gender': r['gender']}
        best = max(best, score_pair(q, b, matcher))
    o = dict(c['observations'])
    o['match_weight'] = max(-20.0, min(30.0, best))
    return [float(o[f]) for f in FEATURES]


def ece(probs, labels, bins=10):
    probs = np.asarray(probs)
    labels = np.asarray(labels)
    total = 0.0
    for i in range(bins):
        lo, hi = i / bins, (i + 1) / bins
        m = (probs >= lo) & ((probs < hi) if i < bins - 1 else (probs <= hi))
        if m.sum():
            total += m.sum() / len(probs) * abs(probs[m].mean() - labels[m].mean())
    return float(total)


def train_scorer(cases, matcher, registry):
    by_cnic = {r['cnic']: r for r in registry}
    X = {s: [] for s in ('train', 'calibration', 'test')}
    y = {s: [] for s in X}
    refs = {s: [] for s in X}
    for c in cases:
        # eligibility is decided by versioned rules and identity ambiguity by the matcher (stop S1); training the
        # evidence scorer on labels its features cannot see would only blur calibration. Excluded from fit and
        # calibration; still counted in the test metrics below.
        if c['category'] in SCORER_EXCLUDE and c['split'] != 'test':
            continue
        X[c['split']].append(case_features(c, matcher, by_cnic, registry))
        y[c['split']].append(1 if c['label'] == 'legitimate' else 0)
        refs[c['split']].append(c)
    Xtr, ytr = np.array(X['train']), np.array(y['train'])
    mean = Xtr.mean(axis=0)
    scale = Xtr.std(axis=0)
    scale[scale == 0] = 1.0
    lr = LogisticRegression(C=1.0, max_iter=2000, solver='lbfgs')
    lr.fit((Xtr - mean) / scale, ytr)

    def raw(Xs):
        return lr.predict_proba((np.array(Xs) - mean) / scale)[:, 1]

    iso = IsotonicRegression(out_of_bounds='clip', y_min=0.0, y_max=1.0)
    iso.fit(raw(X['calibration']), np.array(y['calibration']))

    def calibrated(Xs):
        return np.clip(iso.predict(raw(Xs)), *CLIP)

    # test metrics at the F6 default threshold
    costs = {'wrongApproval': 25000, 'review': 300, 'delay': 200}
    bar_bad = (costs['review'] + costs['delay']) / (costs['wrongApproval'] + costs['delay'])
    pt = calibrated(X['test'])
    yt = np.array(y['test'])
    approve = (1 - pt) < bar_bad
    bad = yt == 0
    clean = np.array([c['category'] == 'clean_legit' for c in refs['test']])
    wrong = int((approve & bad).sum())
    n_bad = int(bad.sum())
    scored_test = np.array([c['category'] not in SCORER_EXCLUDE for c in refs['test']])
    metrics = {
        'dataset': 'D1', 'n_train': len(ytr), 'n_calibration': len(y['calibration']), 'n_test': len(yt),
        'excluded_from_fit': sorted(SCORER_EXCLUDE),
        'ece_calibration': r6(ece(calibrated(X['calibration']), y['calibration'])),
        'ece_test_scored_categories': r6(ece(pt[scored_test], yt[scored_test])),
        'ece_test_all': r6(ece(pt, yt)),
        'threshold_p_legit': r6(1 - bar_bad),
        'score_only': {
            'wrong_approvals': wrong, 'bad_cases': n_bad, 'wrong_approval_upper_95': r6(3 / n_bad) if wrong == 0 and n_bad else None,
            'clean_escalated': int((~approve & clean).sum()), 'clean_cases': int(clean.sum()),
            'wrong_approvals_by_category': {cat: int(sum(1 for i, c in enumerate(refs['test']) if approve[i] and bad[i] and c['category'] == cat))
                                            for cat in sorted({c['category'] for c in refs['test']})},
            'note': 'score threshold only; hard stops and rules route most bad cases before the threshold',
        },
    }
    # isotonic as (x, y) breakpoints, evaluated with linear interpolation and clipping, like sklearn
    art = {
        'version': 'scorer-v1', 'kind': 'logistic+isotonic', 'features': FEATURES,
        'mean': [r6(v) for v in mean], 'scale': [r6(v) for v in scale],
        'coef': [r6(v) for v in lr.coef_[0]], 'intercept': r6(lr.intercept_[0]),
        'calibration': {'x': [r6(v) for v in iso.X_thresholds_], 'y': [r6(v) for v in iso.y_thresholds_]},
        'clip': list(CLIP), 'trained_on': {'dataset': 'D1', 'seed': 2026, 'splits': '300/100/100 stratified by category, by person'},
        'metrics': metrics,
    }
    # parity samples: the probability the exported (rounded) artifact gives, computed the way the runtime does
    def runtime_p(x):
        z = art['intercept'] + sum(c * (v - m) / (s or 1) for c, v, m, s in zip(art['coef'], x, art['mean'], art['scale']))
        p = 1 / (1 + math.exp(-z))
        p = float(np.interp(p, art['calibration']['x'], art['calibration']['y']))
        return min(CLIP[1], max(CLIP[0], p))
    art['parity_samples'] = [{'case_ref': refs['test'][i]['case_ref'], 'features': dict(zip(FEATURES, X['test'][i])), 'p_legit': r6(runtime_p(X['test'][i]))}
                             for i in range(0, len(X['test']), 10)]
    return art


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()
    d1 = json.loads((DATA / 'datasets/d1_cases.json').read_text(encoding='utf-8'))['cases']
    d3 = json.loads((DATA / 'datasets/d3_name_pairs.json').read_text(encoding='utf-8'))['pairs']
    registry = json.loads((DATA / 'seed/mock/identity_records.json').read_text(encoding='utf-8'))
    # sanity: the stored levels are what common.py computes
    for p in d3:
        assert compare_fields(p['a'], p['b']) == p['levels'], p['id']

    matcher = train_matcher(d3)
    scorer = train_scorer(d1, matcher, registry)
    out = {'models/matcher-v1.json': matcher, 'models/scorer-v1.json': scorer}
    if args.check:
        # numeric tolerance: lbfgs can differ in the 6th decimal between platforms (Windows dev, Linux CI)
        def close(a, b):
            if isinstance(a, dict) and isinstance(b, dict):
                return a.keys() == b.keys() and all(close(a[k], b[k]) for k in a)
            if isinstance(a, list) and isinstance(b, list):
                return len(a) == len(b) and all(close(x, y) for x, y in zip(a, b))
            if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
                return math.isclose(a, b, rel_tol=1e-4, abs_tol=1e-4)
            return a == b
        bad = [rel for rel, data in out.items() if not close(json.loads((DATA / rel).read_text(encoding='utf-8')), json.loads(json.dumps(data)))]
        if bad:
            print('trained artifacts differ:', bad)
            sys.exit(1)
        print('artifacts reproduce exactly')
        return
    for rel, data in out.items():
        p = DATA / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, indent=1) + '\n', encoding='utf-8', newline='\n')
    print('matcher', json.dumps(matcher['thresholds']), json.dumps(matcher['metrics']))
    print('scorer', json.dumps(scorer['metrics']))


if __name__ == '__main__':
    main()
