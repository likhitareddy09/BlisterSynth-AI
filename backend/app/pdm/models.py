"""Fault-type classifier and RUL regressor (gradient boosting on window features) + evaluation."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.metrics import (accuracy_score, balanced_accuracy_score, confusion_matrix, f1_score,
                             mean_absolute_error, mean_squared_error, r2_score, roc_auc_score)

from ..simulator import ACTIVE_THRESHOLD, FAULT_KEYS
from .features import window_features

CONSECUTIVE = 3        # a fault counts as detected after this many windows in a row flag a fault


@dataclass
class PdmBundle:
    task: str                          # fault | rul
    model: object
    feature_names: list[str]
    window_s: float
    stride_s: float
    rul_cap_s: float
    classes: list[str] = field(default_factory=list)


def _labels(run: dict, window_s: float, stride_s: float):
    df, cfg = run["df"], run["cfg"]
    F, idx = window_features(df, window_s, stride_s, cfg.nominal_speed_bpm)
    fa = df["fault_active"].to_numpy()[idx] == 1
    y_fault = np.where(fa, df["fault_type"].to_numpy()[idx], "none")
    rul = df["rul_s"].to_numpy(dtype=float)[idx]
    usable = fa & np.isfinite(rul) & (df["fault_profile"].to_numpy()[idx] != "sudden")
    return F, idx, y_fault, rul, usable


def stack(runs: list[dict], window_s: float, stride_s: float):
    parts = [_labels(r, window_s, stride_s) for r in runs]
    F = pd.concat([p[0] for p in parts], ignore_index=True)
    return (F, np.concatenate([p[2] for p in parts]), np.concatenate([p[3] for p in parts]),
            np.concatenate([p[4] for p in parts]))


def train(task: str, runs: list[dict], window_s: float = 60.0, stride_s: float = 30.0,
          rul_cap_s: float = 1200.0, seed: int = 0) -> PdmBundle:
    F, y, rul, usable = stack(runs, window_s, stride_s)
    if task == "fault":
        if len(set(y)) < 2:
            raise ValueError("training runs contain only one class; use more runs or longer runs")
        model = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.1, class_weight="balanced",
                                               random_state=seed).fit(F, y)
        return PdmBundle(task, model, list(F.columns), window_s, stride_s, rul_cap_s, [str(c) for c in model.classes_])
    if usable.sum() < 30:
        raise ValueError("fewer than 30 usable RUL windows; use more runs with gradual/intermittent faults")
    target = np.minimum(rul[usable], rul_cap_s)
    model = HistGradientBoostingRegressor(max_iter=200, learning_rate=0.08, random_state=seed).fit(F[usable], target)
    return PdmBundle(task, model, list(F.columns), window_s, stride_s, rul_cap_s)


def _detection(bundle: PdmBundle, runs: list[dict]) -> dict:
    """Detection delay per fault type (first run of CONSECUTIVE flagged windows after the fault starts)."""
    delays: dict[str, list[float]] = {k: [] for k in FAULT_KEYS}
    missed: dict[str, int] = {k: 0 for k in FAULT_KEYS}
    false_alarm_windows = healthy_windows = 0
    for run in runs:
        df = run["df"]
        F, idx = window_features(df, bundle.window_s, bundle.stride_s, run["cfg"].nominal_speed_bpm)
        flagged = bundle.model.predict(F[bundle.feature_names]) != "none"
        tw = df["t_s"].to_numpy(dtype=float)[idx]
        quiet = df["fault_active"].to_numpy()[idx] == 0
        false_alarm_windows += int((flagged & quiet).sum())
        healthy_windows += int(quiet.sum())
        for key in FAULT_KEYS:
            sev = df[f"sev_{key}"].to_numpy(dtype=float)
            if not (sev > ACTIVE_THRESHOLD).any():
                continue
            start = df["t_s"].to_numpy(dtype=float)[np.argmax(sev > ACTIVE_THRESHOLD)]
            after = tw >= start
            run3 = np.convolve(flagged & after, np.ones(CONSECUTIVE), mode="valid") >= CONSECUTIVE
            hit = np.flatnonzero(run3)
            if len(hit):
                delays[key].append(float(tw[hit[0] + CONSECUTIVE - 1] - start))
            else:
                missed[key] += 1
    per = {k: {"detected": len(v), "missed": missed[k], "median_delay_s": round(float(np.median(v)), 1) if v else None}
           for k, v in delays.items() if v or missed[k]}
    all_d = [d for v in delays.values() for d in v]
    n_faults = len(all_d) + sum(missed.values())
    return {"false_alarm_rate": round(false_alarm_windows / max(1, healthy_windows), 4),
            "detection_rate": round(len(all_d) / max(1, n_faults), 3), "n_faults": n_faults,
            "median_delay_s": round(float(np.median(all_d)), 1) if all_d else None, "per_fault": per}


def evaluate(bundle: PdmBundle, runs: list[dict]) -> dict:
    F, y, rul, usable = stack(runs, bundle.window_s, bundle.stride_s)
    F = F[bundle.feature_names]
    if bundle.task == "fault":
        pred = bundle.model.predict(F)
        labels = sorted(set(y) | set(pred))
        proba = bundle.model.predict_proba(F)
        p_none = proba[:, list(bundle.model.classes_).index("none")] if "none" in bundle.model.classes_ else 0 * y
        out = {"n_windows": int(len(y)), "accuracy": round(float(accuracy_score(y, pred)), 4),
               "balanced_accuracy": round(float(balanced_accuracy_score(y, pred)), 4),
               "macro_f1": round(float(f1_score(y, pred, average="macro", labels=sorted(set(y)))), 4),
               "per_class_recall": {c: round(float((pred[y == c] == c).mean()), 3) for c in sorted(set(y))},
               "labels": labels, "confusion_matrix": confusion_matrix(y, pred, labels=labels).tolist()}
        if len(set(y == "none")) == 2:
            out["fault_vs_none_auc"] = round(float(roc_auc_score(y != "none", 1 - p_none)), 4)
        return out | {"detection": _detection(bundle, runs)}
    truth = np.minimum(rul[usable], bundle.rul_cap_s)
    if usable.sum() == 0:
        return {"n_windows": 0}
    pred = bundle.model.predict(F[usable])
    base = np.full_like(truth, truth.mean())
    near = truth < 300
    return {"n_windows": int(usable.sum()), "mae_s": round(float(mean_absolute_error(truth, pred)), 1),
            "rmse_s": round(float(np.sqrt(mean_squared_error(truth, pred))), 1),
            "r2": round(float(r2_score(truth, pred)), 4),
            "baseline_mae_s": round(float(mean_absolute_error(truth, base)), 1),
            "mae_last_300s": round(float(mean_absolute_error(truth[near], pred[near])), 1) if near.any() else None}


def predict_run(bundle: PdmBundle, df: pd.DataFrame, nominal: float = 220.0) -> dict:
    F, idx = window_features(df, bundle.window_s, bundle.stride_s, nominal)
    F = F[bundle.feature_names]
    t = df["t_s"].to_numpy(dtype=float)[idx].round(1).tolist()
    if bundle.task == "fault":
        proba = bundle.model.predict_proba(F)
        cls = list(bundle.model.classes_)
        p_fault = 1 - proba[:, cls.index("none")] if "none" in cls else np.ones(len(F))
        return {"t_s": t, "predicted": [str(c) for c in bundle.model.predict(F)],
                "p_fault": p_fault.round(4).tolist()}
    return {"t_s": t, "rul_s": np.clip(bundle.model.predict(F), 0, bundle.rul_cap_s).round(1).tolist(),
            "rul_cap_s": bundle.rul_cap_s}
