"""Fidelity metrics: how close are synthetic runs to physics runs of the same scenario?

compare_runs : one real run vs one synthetic run (marginals, scale, correlation, temporal structure).
compare_sets : several matched run pairs + a discriminator tested on *held-out runs*. (A discriminator on a
               single pair just learns which run a window came from, because every run has its own drift
               and shift offsets - so that test is only done across runs.)
Scores are 0-100 (100 = identical). Marginal/scale/temporal components look at the WORST three sensors, so a few
badly generated sensors cannot hide behind many good ones.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import ks_2samp
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score

from .features import SENSOR_KEYS, window_features

CONTINUOUS = [k for k in SENSOR_KEYS if k != "pocket_fill_count"]
TOP = 3


def _running(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["machine_state"] == "running"] if "machine_state" in df else df


def _residual(x: np.ndarray) -> np.ndarray:
    return x - pd.Series(x).rolling(61, center=True, min_periods=1).mean().to_numpy()


def _lag1(x: np.ndarray) -> float:
    return float(np.corrcoef(x[:-1], x[1:])[0, 1]) if len(x) > 3 and x.std() > 0 else 0.0


def _worst(values: list[float]) -> float:
    return float(np.mean(sorted(values, reverse=True)[:TOP]))


def compare_runs(real: pd.DataFrame, syn: pd.DataFrame) -> dict:
    r, s = _running(real), _running(syn)
    if len(r) < 50 or len(s) < 50:
        raise ValueError("need at least 50 running samples in both runs")
    per, ks_all, log_ratio, ac_diff, res_r, res_s = {}, [], [], [], {}, {}
    for key in SENSOR_KEYS:
        a, b = r[key].to_numpy(dtype=float), s[key].to_numpy(dtype=float)
        ks = float(ks_2samp(a[::max(1, len(a) // 20000)], b[::max(1, len(b) // 20000)]).statistic)
        sd_a, sd_b = a.std() + 1e-9, b.std() + 1e-9
        entry = {"mean_err_sd": round(float((b.mean() - a.mean()) / sd_a), 3), "std_ratio": round(float(sd_b / sd_a), 3),
                 "ks": round(ks, 3)}
        ks_all.append(ks)
        log_ratio.append(abs(float(np.log(sd_b / sd_a))))
        if key in CONTINUOUS:
            res_r[key], res_s[key] = _residual(a), _residual(b)
            entry["lag1_real"], entry["lag1_syn"] = round(_lag1(res_r[key]), 3), round(_lag1(res_s[key]), 3)
            ac_diff.append(abs(entry["lag1_real"] - entry["lag1_syn"]))
        per[key] = entry
    n = min(len(next(iter(res_r.values()))), len(next(iter(res_s.values()))))
    with np.errstate(invalid="ignore", divide="ignore"):
        cr = np.corrcoef(np.vstack([v[:n] for v in res_r.values()]))
        cs = np.corrcoef(np.vstack([v[:n] for v in res_s.values()]))
    corr_dist = float(np.nanmean(np.abs(cr[np.triu_indices(len(CONTINUOUS), 1)] - cs[np.triu_indices(len(CONTINUOUS), 1)])))
    comps = {"marginals": 1 - _worst(ks_all), "scale": 1 - min(1.0, _worst(log_ratio) / np.log(2)),
             "correlation": 1 - min(1.0, corr_dist / 0.5), "temporal": 1 - min(1.0, _worst(ac_diff) / 0.5)}
    comps = {k: round(max(0.0, float(v)), 3) for k, v in comps.items()}
    return {"sensors": per, "corr_distance": round(corr_dist, 4), "components": comps,
            "score": round(100 * float(np.mean(list(comps.values()))), 1)}


def discriminator_auc(real_runs: list[pd.DataFrame], syn_runs: list[pd.DataFrame],
                      window_s: float = 60.0, stride_s: float = 15.0) -> float | None:
    """Real-vs-synthetic AUC on windows of runs the classifier never saw (0.5 = cannot tell apart)."""
    if min(len(real_runs), len(syn_runs)) < 6:
        return None
    X_tr, y_tr, X_te, y_te = [], [], [], []
    for label, runs in ((0, real_runs), (1, syn_runs)):
        for i, df in enumerate(runs):
            F, _ = window_features(df, window_s, stride_s)
            (X_te if i % 3 == 0 else X_tr).append(F)
            (y_te if i % 3 == 0 else y_tr).append(np.full(len(F), label))
    clf = HistGradientBoostingClassifier(max_iter=100, random_state=0).fit(pd.concat(X_tr), np.concatenate(y_tr))
    return float(roc_auc_score(np.concatenate(y_te), clf.predict_proba(pd.concat(X_te))[:, 1]))


def compare_sets(real_runs: list[pd.DataFrame], syn_runs: list[pd.DataFrame]) -> dict:
    """Matched pairs (same scenario, same index) + held-out-run discriminator."""
    pairs = [compare_runs(a, b) for a, b in zip(real_runs, syn_runs)]
    comps = {k: round(float(np.mean([p["components"][k] for p in pairs])), 3) for k in pairs[0]["components"]}
    auc = discriminator_auc(real_runs, syn_runs)
    if auc is not None:
        comps["indistinguishability"] = round(max(0.0, 1 - min(1.0, 2 * abs(auc - 0.5))), 3)
    worst = {}
    for key in SENSOR_KEYS:
        worst[key] = round(float(np.mean([p["sensors"][key]["ks"] for p in pairs])), 3)
    return {"n_pairs": len(pairs), "components": comps, "discriminator_auc": None if auc is None else round(auc, 4),
            "score": round(100 * float(np.mean(list(comps.values()))), 1),
            "pair_scores": [p["score"] for p in pairs], "mean_ks_by_sensor": worst}
