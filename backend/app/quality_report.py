"""Synthetic-data quality report (Phase 7A).  Everything the /app/quality page shows is computed here.

Inputs are two lists of DataFrames in the run layout: `real` and `syn` (saved runs or Data Lab datasets).

The three headline gauges (all 0-100, higher is better) - the definitions are repeated in the UI tooltips:

  FIDELITY  = the Phase 4 fidelity score: mean of marginals (KS), scale (std ratio), correlation and temporal (lag-1
              autocorrelation) components, plus indistinguishability when a held-out-run discriminator can be trained.
              "Does the synthetic data look like the real data?"
  UTILITY   = TSTR / TRTR, as a percentage (capped at 100).  TSTR = macro-F1 of a fault classifier trained on SYNTHETIC
              windows and tested on REAL windows; TRTR = the same classifier trained on REAL windows (different real runs
              than the test windows) and tested on the same real test windows.  100 = synthetic data is as useful as real.
              "Can I train a model on it?"
  DIVERSITY = Coverage (Naeem et al. 2020, k = 5): the share of REAL windows that have at least one SYNTHETIC window
              inside their k-nearest-neighbour ball.  Low coverage = the generator misses parts of the real behaviour.
              "Does it cover everything the real data does?"  A separate mode-collapse check flags generators whose
              samples are much less spread out than real data or that leave real clusters empty.
"""
from __future__ import annotations

import math
import warnings
from typing import Any

import numpy as np
import pandas as pd
from scipy.stats import gaussian_kde, ks_2samp
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.manifold import TSNE
from sklearn.metrics import balanced_accuracy_score, accuracy_score, f1_score
from sklearn.preprocessing import StandardScaler

from .pdm.features import SENSOR_KEYS, window_features
from .pdm.quality import compare_runs, compare_sets

KS_PASS_D = 0.10        # a sensor "passes" when the KS statistic D <= 0.10 (p-values alone reject tiny differences on big samples)
KNN_K = 5
COLLAPSE_SPREAD = 0.5   # synthetic nearest-neighbour spread below 50 % of real = suspected collapse
COLLAPSE_MODES = 0.5    # fewer than 50 % of real clusters occupied by synthetic samples = suspected collapse
WINDOW_S, STRIDE_S = 60.0, 30.0
MAX_TRAIN_WINDOWS = 6000


def clean(obj: Any) -> Any:
    """Make nested results JSON-safe (NaN / Inf -> None, numpy -> python)."""
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return clean(obj.tolist())
    if isinstance(obj, (np.floating, float)):
        return None if not math.isfinite(float(obj)) else float(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def _running(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["machine_state"] == "running"] if "machine_state" in df else df


def pooled(dfs: list[pd.DataFrame]) -> pd.DataFrame:
    """Running samples of all frames stacked, sensors only."""
    return pd.concat([_running(d)[SENSOR_KEYS] for d in dfs], ignore_index=True).astype(float)


def _subsample(a: np.ndarray, n: int, seed: int = 0) -> np.ndarray:
    if len(a) <= n:
        return a
    return a[np.random.default_rng(seed).choice(len(a), n, replace=False)]


# ------------------------------------------------------------------ 1. KS table
def ks_table(real: pd.DataFrame, syn: pd.DataFrame) -> list[dict]:
    rows = []
    for k in SENSOR_KEYS:
        a, b = _subsample(real[k].to_numpy(), 20000), _subsample(syn[k].to_numpy(), 20000)
        res = ks_2samp(a, b)
        rows.append({"sensor": k, "ks": round(float(res.statistic), 4), "p_value": float(res.pvalue), "pass": bool(res.statistic <= KS_PASS_D),
                     "mean_real": float(real[k].mean()), "mean_syn": float(syn[k].mean()),
                     "std_real": float(real[k].std()), "std_syn": float(syn[k].std())})
    return rows


# ------------------------------------------------------------------ 2. correlation heatmaps
def corr_matrices(real: pd.DataFrame, syn: pd.DataFrame) -> dict:
    """Pearson correlation of running samples (all 14 sensors). A constant sensor correlates 0 with everything."""
    def corr(df: pd.DataFrame) -> np.ndarray:
        c = df.corr().to_numpy()
        c = np.nan_to_num(c, nan=0.0)
        np.fill_diagonal(c, 1.0)
        return c
    cr, cs = corr(real), corr(syn)
    diff = cs - cr
    iu = np.triu_indices(len(SENSOR_KEYS), 1)
    return {"sensors": SENSOR_KEYS, "real": np.round(cr, 3), "syn": np.round(cs, 3), "diff": np.round(diff, 3),
            "mean_abs_diff": round(float(np.abs(diff[iu]).mean()), 4)}


# ------------------------------------------------------------------ windows (shared by PCA, t-SNE, diversity, TSTR)
def windows(dfs: list[pd.DataFrame]) -> tuple[pd.DataFrame, np.ndarray, np.ndarray]:
    """Feature windows of all frames: (features, fault labels, index of the frame each window came from)."""
    Fs, ys, grp = [], [], []
    for i, df in enumerate(dfs):
        F, idx = window_features(df, WINDOW_S, STRIDE_S, float(np.nanmax(df["line_speed_bpm"].to_numpy()) or 220.0))
        F = F.dropna()
        keep = F.index.to_numpy()
        fa = df["fault_active"].to_numpy()[idx][keep] == 1 if "fault_active" in df else np.zeros(len(keep), bool)
        ft = df["fault_type"].to_numpy()[idx][keep] if "fault_type" in df else np.array(["none"] * len(keep))
        Fs.append(F.reset_index(drop=True))
        ys.append(np.where(fa, ft, "none"))
        grp.append(np.full(len(F), i))
    return pd.concat(Fs, ignore_index=True), np.concatenate(ys), np.concatenate(grp)


# ------------------------------------------------------------------ 3. PCA / t-SNE
def embeddings(Fr: pd.DataFrame, Fs: pd.DataFrame, max_points: int, tsne: bool, seed: int) -> dict:
    sc = StandardScaler().fit(Fr)
    Zr, Zs = sc.transform(Fr), sc.transform(Fs)
    pca = PCA(n_components=2, random_state=seed).fit(Zr)
    pr, ps = pca.transform(Zr), pca.transform(Zs)
    ir = np.random.default_rng(seed).permutation(len(pr))[:max_points]
    is_ = np.random.default_rng(seed + 1).permutation(len(ps))[:max_points]
    out: dict[str, Any] = {"pca": {"real": np.round(pr[ir], 3), "syn": np.round(ps[is_], 3),
                                   "explained": np.round(pca.explained_variance_ratio_, 4)}, "tsne": None, "tsne_note": None}
    if not tsne:
        out["tsne_note"] = "t-SNE was switched off."
        return out
    cap = min(max_points, 300)                                   # t-SNE is O(n^2): keep the sample small
    jr, js = np.random.default_rng(seed + 2).permutation(len(Zr))[:cap], np.random.default_rng(seed + 3).permutation(len(Zs))[:cap]
    if min(len(jr), len(js)) < 15:
        out["tsne_note"] = "Too few windows for t-SNE (need at least 15 per side)."
        return out
    both = np.vstack([Zr[jr], Zs[js]])
    emb = TSNE(n_components=2, perplexity=max(5.0, min(30.0, (len(both) - 1) / 4)), init="pca", learning_rate="auto",
               random_state=seed).fit_transform(both)
    out["tsne"] = {"real": np.round(emb[:len(jr)], 3), "syn": np.round(emb[len(jr):], 3), "n_per_side": cap}
    out["tsne_note"] = f"t-SNE on a random sample of {len(jr)} real + {len(js)} synthetic windows (capped for speed)."
    return out


# ------------------------------------------------------------------ 4. distributions
def distributions(real: pd.DataFrame, syn: pd.DataFrame, bins: int = 30) -> dict:
    out = {}
    for k in SENSOR_KEYS:
        a, b = real[k].to_numpy(), syn[k].to_numpy()
        lo, hi = float(min(a.min(), b.min())), float(max(a.max(), b.max()))
        if hi - lo < 1e-9:
            lo, hi = lo - 1, hi + 1
        edges = np.linspace(lo, hi, bins + 1)
        centres = (edges[:-1] + edges[1:]) / 2
        hr, _ = np.histogram(a, bins=edges, density=True)
        hs, _ = np.histogram(b, bins=edges, density=True)
        grid = np.linspace(lo, hi, 80)

        def kde(x: np.ndarray) -> np.ndarray:
            x = _subsample(x, 2000)
            if x.std() < 1e-9 or len(x) < 3:
                return np.zeros_like(grid)
            try:
                return gaussian_kde(x)(grid)
            except (np.linalg.LinAlgError, ValueError):
                return np.zeros_like(grid)
        out[k] = {"x": np.round(centres, 4), "real_hist": np.round(hr, 5), "syn_hist": np.round(hs, 5),
                  "kde_x": np.round(grid, 4), "real_kde": np.round(kde(a), 5), "syn_kde": np.round(kde(b), 5)}
    return out


# ------------------------------------------------------------------ 5. TSTR vs TRTR (-> Utility)
def _clf(seed: int) -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(max_iter=80, learning_rate=0.12, class_weight="balanced", random_state=seed)


def _scores(y_true: np.ndarray, pred: np.ndarray) -> dict:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")            # "y_pred contains classes not in y_true" is expected here
        return _scores_inner(y_true, pred)


def _scores_inner(y_true: np.ndarray, pred: np.ndarray) -> dict:
    return {"macro_f1": round(float(f1_score(y_true, pred, average="macro", labels=sorted(set(y_true)))), 4),
            "accuracy": round(float(accuracy_score(y_true, pred)), 4),
            "balanced_accuracy": round(float(balanced_accuracy_score(y_true, pred)), 4)}


def tstr_trtr(real_dfs: list[pd.DataFrame], syn_dfs: list[pd.DataFrame], seed: int = 0,
              real_test_dfs: list[pd.DataFrame] | None = None) -> dict:
    """Utility = TSTR / TRTR on the SAME real test windows.

    * `real_test_dfs` given (model mode): train on `real_dfs` (TRTR) or `syn_dfs` (TSTR), test on the held-out real runs.
    * otherwise the real frames are split so TRTR never trains on the windows it is tested on: by run when there are
      2+ real frames (even index = train, odd = test), else in time blocks with a 2-window gap (windows overlap)."""
    Fs, ys, _ = windows(syn_dfs)
    if real_test_dfs:
        Fr, yr, _ = windows(real_dfs)
        Fte, yte, _ = windows(real_test_dfs)
        Ftr_all, ytr_all, split = Fr, yr, "held-out real runs"
    else:
        Fr, yr, gr = windows(real_dfs)
        if len(real_dfs) >= 2:
            tr, te = gr % 2 == 0, gr % 2 == 1
        else:
            block = np.arange(len(Fr)) // 12
            tr, te = block % 2 == 0, block % 2 == 1
            tr = tr & ~((np.arange(len(Fr)) % 12 < 2) & (np.arange(len(Fr)) > 0))      # purge 2 windows after each boundary
        Ftr_all, ytr_all, Fte, yte = Fr[tr], yr[tr], Fr[te], yr[te]
        split = "by run" if len(real_dfs) >= 2 else "time blocks"
    reason = None
    if len(set(yte)) < 2:
        reason = "The real data has fewer than 2 fault classes among its test windows (no labelled faults?), so a classifier cannot be scored."
    elif len(set(ytr_all)) < 2:
        reason = "The real training windows contain only one class, so the TRTR baseline cannot be trained."
    elif len(set(ys)) < 2:
        reason = "The synthetic data contains only one class (no faults), so a classifier cannot be trained on it."
    if reason:
        return {"available": False, "reason": reason}

    def cap(F: pd.DataFrame, y: np.ndarray):
        if len(F) <= MAX_TRAIN_WINDOWS:
            return F, y
        i = np.random.default_rng(seed).choice(len(F), MAX_TRAIN_WINDOWS, replace=False)
        return F.iloc[i], y[i]
    Ftr, ytr = cap(Ftr_all, ytr_all)
    Fsy, ysy = cap(Fs, ys)
    trtr = _scores(yte, _clf(seed).fit(Ftr, ytr).predict(Fte[Ftr.columns]))
    tstr = _scores(yte, _clf(seed).fit(Fsy, ysy).predict(Fte[Fsy.columns]))
    ratio = tstr["macro_f1"] / trtr["macro_f1"] if trtr["macro_f1"] > 0 else None
    weak = trtr["macro_f1"] < 0.25 or len(Ftr) < 150
    return {"available": True, "tstr": tstr, "trtr": trtr, "utility_ratio": None if ratio is None else round(ratio, 4),
            "baseline_weak": bool(weak),          # a poor real-data baseline makes the ratio unreliable - the UI warns
            "baseline_note": "The TRTR baseline is weak (small or hard real set), so the ratio is not reliable. Use more real runs." if weak else "",
            "classes": sorted(set(yte)), "n_train_real": int(len(Ftr)), "n_train_syn": int(len(Fsy)), "n_test": int(len(Fte)), "split": split}


def utility_value(t: dict) -> float | None:
    """Gauge value: TSTR/TRTR as a percentage, capped at 100."""
    if not t.get("available") or t.get("utility_ratio") is None:
        return None
    return round(min(1.0, max(0.0, t["utility_ratio"])) * 100, 1)


# ------------------------------------------------------------------ 6. diversity (coverage + mode collapse)
def _knn_radius(Z: np.ndarray, k: int) -> np.ndarray:
    """Distance of every point to its k-th nearest neighbour inside the same set (itself excluded)."""
    d = np.linalg.norm(Z[:, None, :] - Z[None, :, :], axis=-1)
    d.sort(axis=1)
    return d[:, min(k, len(Z) - 1)]


def diversity(Fr: pd.DataFrame, Fs: pd.DataFrame, seed: int = 0, cap: int = 600) -> dict:
    sc = StandardScaler().fit(Fr)
    Zr, Zs = _subsample(sc.transform(Fr), cap, seed), _subsample(sc.transform(Fs), cap, seed + 1)
    if min(len(Zr), len(Zs)) < 12:
        return {"available": False, "reason": "Need at least 12 windows on each side."}
    pca = PCA(n_components=min(10, Zr.shape[1], len(Zr) - 1), random_state=seed).fit(Zr)
    Zr, Zs = pca.transform(Zr), pca.transform(Zs)
    k = min(KNN_K, len(Zr) - 1, len(Zs) - 1)
    r_real, r_syn = _knn_radius(Zr, k), _knn_radius(Zs, k)
    cross = np.linalg.norm(Zr[:, None, :] - Zs[None, :, :], axis=-1)            # (real, syn)
    coverage = float((cross.min(axis=1) <= r_real).mean())                      # real points with a synthetic neighbour in their ball
    recall = float((cross <= r_syn[None, :]).any(axis=1).mean())                # real points inside the synthetic manifold
    nn_real, nn_syn = _knn_radius(Zr, 1), _knn_radius(Zs, 1)
    spread = float(np.median(nn_syn) / max(1e-9, np.median(nn_real)))
    n_clusters = int(max(2, min(8, len(Zr) // 15)))
    km = KMeans(n_clusters=n_clusters, n_init=5, random_state=seed).fit(Zr)
    share_r = np.bincount(km.labels_, minlength=n_clusters) / len(Zr)
    share_s = np.bincount(km.predict(Zs), minlength=n_clusters) / len(Zs)
    occupied = (share_s >= 0.25 * share_r) & (share_s > 0)
    mode_cov = float(occupied.mean())
    collapse = bool(spread < COLLAPSE_SPREAD or mode_cov < COLLAPSE_MODES)
    reasons = []
    if spread < COLLAPSE_SPREAD:
        reasons.append(f"synthetic windows are {spread:.2f}x as spread out as real ones (limit {COLLAPSE_SPREAD})")
    if mode_cov < COLLAPSE_MODES:
        reasons.append(f"only {int(occupied.sum())} of {n_clusters} real behaviour clusters are populated")
    return {"available": True, "coverage": round(coverage, 4), "recall": round(recall, 4), "k": int(k), "spread_ratio": round(spread, 3),
            "mode_coverage": round(mode_cov, 3), "n_clusters": n_clusters, "cluster_share_real": np.round(share_r, 3),
            "cluster_share_syn": np.round(share_s, 3), "collapse_suspected": collapse,
            "collapse_reason": "; ".join(reasons) if reasons else "no sign of mode collapse",
            "n_real": int(len(Zr)), "n_syn": int(len(Zs))}


# ------------------------------------------------------------------ 7. fidelity (existing Phase 4 score)
def fidelity(real_dfs: list[pd.DataFrame], syn_dfs: list[pd.DataFrame]) -> dict:
    if len(real_dfs) == len(syn_dfs):
        res = compare_sets(real_dfs, syn_dfs)
        return {"score": res["score"], "components": res["components"], "discriminator_auc": res["discriminator_auc"],
                "mode": f"{res['n_pairs']} matched pair(s)"}
    res = compare_runs(pd.concat(real_dfs, ignore_index=True), pd.concat(syn_dfs, ignore_index=True))
    return {"score": res["score"], "components": res["components"], "discriminator_auc": None, "mode": "pooled"}


# ------------------------------------------------------------------ everything
def build_report(real_dfs: list[pd.DataFrame], syn_dfs: list[pd.DataFrame], *, include_tsne: bool = True,
                 max_points: int = 400, seed: int = 0, real_test_dfs: list[pd.DataFrame] | None = None) -> dict:
    if not real_dfs or not syn_dfs:
        raise ValueError("Pick at least one real and one synthetic source.")
    real, syn = pooled(real_dfs), pooled(syn_dfs)
    if len(real) < 50 or len(syn) < 50:
        raise ValueError("Need at least 50 running samples on each side.")
    Fr, yr, _ = windows(real_dfs)
    Fs, ys, _ = windows(syn_dfs)
    if min(len(Fr), len(Fs)) < 10:
        raise ValueError("Too few feature windows (each run needs more than 2 minutes of data).")
    fid = fidelity(real_dfs, syn_dfs)
    ts = tstr_trtr(real_dfs, syn_dfs, seed, real_test_dfs)
    div = diversity(Fr, Fs, seed)
    gauges = {"fidelity": fid["score"], "utility": utility_value(ts),
              "diversity": round(100 * div["coverage"], 1) if div.get("available") else None}
    return clean({
        "gauges": gauges, "fidelity": fid, "ks": ks_table(real, syn), "ks_pass_d": KS_PASS_D,
        "correlation": corr_matrices(real, syn), "embeddings": embeddings(Fr, Fs, max_points, include_tsne, seed),
        "distributions": distributions(real, syn), "tstr": ts, "diversity": div,
        "sizes": {"real_runs": len(real_dfs), "syn_runs": len(syn_dfs), "real_samples": int(len(real)), "syn_samples": int(len(syn)),
                  "real_windows": int(len(Fr)), "syn_windows": int(len(Fs))},
        "definitions": {
            "fidelity": "Phase 4 fidelity score: marginals (KS), scale, correlation and temporal structure (plus indistinguishability when 6+ runs exist). 100 = identical.",
            "utility": "TSTR / TRTR: macro-F1 of a fault classifier trained on synthetic data divided by the same classifier trained on real data, both tested on real windows. 100 = as useful as real data.",
            "diversity": "Coverage (k=5): share of real windows with a synthetic window inside their nearest-neighbour ball. Low = the generator misses real behaviour.",
        }})
