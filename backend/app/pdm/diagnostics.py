"""PdM diagnostics for the PdM page (Phase 7A): confusion matrix, ROC, feature importance, RUL scatter,
and the "imbalance fix" experiment (real-only vs real + synthetic training)."""
from __future__ import annotations

import warnings
from collections import Counter

import numpy as np
from sklearn.inspection import permutation_importance
from sklearn.metrics import (accuracy_score, balanced_accuracy_score, confusion_matrix, f1_score, mean_absolute_error,
                             r2_score, roc_auc_score, roc_curve)

from . import models as pm
from .data import make_imbalanced_scenarios, make_runs, make_scenarios
from .experiment import TEST_SEED_OFFSET

MAX_ROC_POINTS = 70
MAX_SCATTER = 400
MAX_PERM_ROWS = 1200
TOP_FEATURES = 15


def _thin(fpr: np.ndarray, tpr: np.ndarray, n: int = MAX_ROC_POINTS) -> list[list[float]]:
    """Keep at most n points of a ROC curve (evenly spaced along the curve, endpoints kept)."""
    idx = np.unique(np.linspace(0, len(fpr) - 1, min(n, len(fpr))).round().astype(int))
    return [[round(float(fpr[i]), 4), round(float(tpr[i]), 4)] for i in idx]


def _importance(bundle: pm.PdmBundle, F, y, scoring: str, seed: int) -> dict:
    """Permutation importance (HistGradientBoosting has no native importances): how much the score drops when one
    feature's values are shuffled. Also summed per sensor (a feature name is '<sensor>__mean|std|delta')."""
    if len(F) > MAX_PERM_ROWS:
        i = np.random.default_rng(seed).choice(len(F), MAX_PERM_ROWS, replace=False)
        F, y = F.iloc[i], y[i]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        res = permutation_importance(bundle.model, F, y, scoring=scoring, n_repeats=3, random_state=seed, n_jobs=1)
    imp = np.maximum(res.importances_mean, 0.0)
    order = np.argsort(imp)[::-1][:TOP_FEATURES]
    by_sensor: dict[str, float] = {}
    for name, v in zip(F.columns, imp):
        sensor = name.split("__")[0]
        by_sensor[sensor] = by_sensor.get(sensor, 0.0) + float(v)
    return {"method": f"permutation importance ({scoring}, 3 repeats)",
            "features": [{"feature": F.columns[i], "importance": round(float(imp[i]), 5), "std": round(float(res.importances_std[i]), 5)} for i in order],
            "by_sensor": sorted(({"sensor": k, "importance": round(v, 5)} for k, v in by_sensor.items()), key=lambda d: -d["importance"])}


def test_runs(duration_s: int, n_runs: int, seed: int) -> list[dict]:
    """Held-out physics runs (same seed offset as the Phase 4 experiments, so they are never training seeds)."""
    return make_runs(make_scenarios(n_runs, duration_s, seed + TEST_SEED_OFFSET))


def diagnostics(bundle: pm.PdmBundle, runs: list[dict], seed: int = 0) -> dict:
    F, y, rul, usable = pm.stack(runs, bundle.window_s, bundle.stride_s)
    F = F[bundle.feature_names]
    if bundle.task == "fault":
        pred = bundle.model.predict(F)
        proba = bundle.model.predict_proba(F)
        classes = [str(c) for c in bundle.model.classes_]
        labels = sorted(set(y) | set(pred))
        cm = confusion_matrix(y, pred, labels=labels)
        roc = []
        for j, c in enumerate(classes):
            pos = y == c
            if pos.any() and (~pos).any():
                fpr, tpr, _ = roc_curve(pos, proba[:, j])
                roc.append({"class": c, "auc": round(float(roc_auc_score(pos, proba[:, j])), 4), "points": _thin(fpr, tpr), "n_positive": int(pos.sum())})
        fvn = None
        if "none" in classes and (y == "none").any() and (y != "none").any():
            score = 1 - proba[:, classes.index("none")]
            fpr, tpr, _ = roc_curve(y != "none", score)
            fvn = {"auc": round(float(roc_auc_score(y != "none", score)), 4), "points": _thin(fpr, tpr)}
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            f1 = float(f1_score(y, pred, average="macro", labels=sorted(set(y))))
        return {"task": "fault", "n_windows": int(len(y)), "labels": labels, "confusion_matrix": cm.tolist(),
                "accuracy": round(float(accuracy_score(y, pred)), 4), "balanced_accuracy": round(float(balanced_accuracy_score(y, pred)), 4),
                "macro_f1": round(f1, 4), "per_class_recall": {c: round(float((pred[y == c] == c).mean()), 3) for c in sorted(set(y))},
                "roc_per_class": roc, "roc_fault_vs_none": fvn,
                "importance": _importance(bundle, F, y, "f1_macro", seed)}
    if usable.sum() < 5:
        raise ValueError("The test runs contain too few RUL windows; use more or longer runs.")
    truth = np.minimum(rul[usable], bundle.rul_cap_s)
    Fu = F[usable]
    pred = bundle.model.predict(Fu)
    i = np.random.default_rng(seed).permutation(len(truth))[:MAX_SCATTER]
    return {"task": "rul", "n_windows": int(len(truth)), "rul_cap_s": bundle.rul_cap_s,
            "mae_s": round(float(mean_absolute_error(truth, pred)), 1), "r2": round(float(r2_score(truth, pred)), 4),
            "scatter": [[round(float(a), 1), round(float(b), 1)] for a, b in zip(truth[i], pred[i])],
            "importance": _importance(bundle, Fu, truth, "neg_mean_absolute_error", seed)}


def _class_counts(runs: list[dict], bundle_window: float, stride: float) -> dict[str, int]:
    _, y, _, _ = pm.stack(runs, bundle_window, stride)
    return {k: int(v) for k, v in sorted(Counter(y).items())}


def imbalance_experiment(generator, *, n_real: int = 10, n_fault_real: int = 2, n_synth: int = 24, n_test: int = 12,
                         duration_s: int = 1200, window_s: float = 60.0, stride_s: float = 30.0, seed: int = 7) -> dict:
    """Same classifier, two training sets, one physics test set.

      real_only            : `n_real` physics runs of which only `n_fault_real` contain faults (a mostly healthy plant)
      real_plus_synthetic  : the same real runs + `n_synth` runs from the generator (scenarios with faults of every type)

    The generator was trained earlier on the simulator's seed set, so it carries knowledge of fault types the few real
    runs never showed - say this when you present it."""
    real_runs = make_runs(make_imbalanced_scenarios(n_real, duration_s, seed, n_fault_real))
    syn_runs = make_runs(make_scenarios(n_synth, duration_s, seed + 500), model=generator)
    tests = test_runs(duration_s, n_test, seed)
    out = {}
    for key, train_runs in (("real_only", real_runs), ("real_plus_synthetic", real_runs + syn_runs)):
        bundle = pm.train("fault", train_runs, window_s, stride_s, seed=seed)
        m = pm.evaluate(bundle, tests)
        out[key] = {"macro_f1": m["macro_f1"], "accuracy": m["accuracy"], "balanced_accuracy": m["balanced_accuracy"],
                    "per_class_recall": m["per_class_recall"], "train_class_counts": _class_counts(train_runs, window_s, stride_s),
                    "n_train_runs": len(train_runs)}
    a, b = out["real_only"], out["real_plus_synthetic"]
    classes = sorted(set(a["per_class_recall"]) | set(b["per_class_recall"]))
    rows = [{"class": c, "recall_real": a["per_class_recall"].get(c, 0.0), "recall_aug": b["per_class_recall"].get(c, 0.0),
             "delta": round(b["per_class_recall"].get(c, 0.0) - a["per_class_recall"].get(c, 0.0), 3)} for c in classes]
    d = round(b["macro_f1"] - a["macro_f1"], 4)
    out["improvement"] = {
        "macro_f1_delta": d, "macro_f1_relative": None if a["macro_f1"] <= 0 else round(d / a["macro_f1"], 3),
        "classes": rows, "classes_improved": sum(r["delta"] > 0.001 for r in rows), "classes_worse": sum(r["delta"] < -0.001 for r in rows),
        "headline": (f"Macro-F1 improved from {a['macro_f1']:.2f} to {b['macro_f1']:.2f} (+{d:.2f}) after adding synthetic data."
                     if d > 0.005 else f"Macro-F1 changed from {a['macro_f1']:.2f} to {b['macro_f1']:.2f}: no clear improvement in this run."),
        "note": "The generator was trained on the simulator's seed set, so it can supply fault types that the few real runs never showed."}
    out["setup"] = {"n_real": n_real, "n_fault_real": n_fault_real, "n_synth": n_synth, "n_test": n_test, "duration_s": duration_s, "seed": seed}
    return out
