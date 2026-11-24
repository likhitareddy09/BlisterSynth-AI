"""Ground-truth labels attached to every simulated row.

Because the data is *simulated*, we know exactly which fault is acting on the
machine at every second. That is the big advantage over real plant data, where
labels are scarce and noisy. Every row therefore carries these columns:

    fault_active    1 while any fault's severity is above ACTIVE_THRESHOLD, else 0
    fault_type      the dominant active fault ("none" when healthy)
    fault_station   the station that fault lives in ("none" when healthy)
    fault_profile   gradual | sudden | intermittent ("none" when healthy)
    fault_severity  0..1 degradation progress of the dominant fault
                    (intensity is NOT included: severity is the profile curve)
    fault_count     how many faults are active right now
    sev_<type>      one column per fault type (8): that fault's severity 0..1, so
                    several simultaneous faults are all visible (multi-label truth;
                    also the natural conditioning vector for the Phase 3 generator)
    rul_s           Remaining Useful Life in seconds: time until the *nearest
                    failure* among the configured faults. Empty (NaN) when no
                    failure is pending (healthy run, or fault repaired first).

How RUL is defined
------------------
Every fault has a failure time:
    gradual / intermittent : onset + ramp_s   (severity reaches 1.0)
    sudden                 : onset            (instant failure)
RUL(t) = max(failure_time - t, 0). It is the true, noise-free countdown, so it is
the regression target for the Phase 4 RUL model. Sudden faults have a countdown
that no sensor can foresee, so train RUL models on gradual / intermittent rows.
Before onset the countdown still runs; PdM papers usually cap it
(see `capped_rul`) so the model is not asked to predict far-future failures.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

NONE = "none"
ACTIVE_THRESHOLD = 0.05   # severity above which a fault counts as "active"

# Must match faults.FAULT_TYPES (faults.py asserts this at import time).
FAULT_KEYS = (
    "bearing_wear", "sealing_heater_degradation", "seal_pressure_leak", "vacuum_leak",
    "film_tension_instability", "cooling_blockage", "punch_dulling", "pocket_feeder_jam",
)
SEV_COLUMNS = [f"sev_{k}" for k in FAULT_KEYS]

LABEL_COLUMNS = [
    "fault_active", "fault_type", "fault_station", "fault_profile",
    "fault_severity", "fault_count", "rul_s", *SEV_COLUMNS,
]


def init_label_columns(data: pd.DataFrame) -> None:
    """Add the label columns in their healthy state (used for every run, faulty or not)."""
    n = len(data)
    data["fault_active"] = np.zeros(n, dtype=np.int64)
    data["fault_type"] = np.full(n, NONE, dtype=object)
    data["fault_station"] = np.full(n, NONE, dtype=object)
    data["fault_profile"] = np.full(n, NONE, dtype=object)
    data["fault_severity"] = np.zeros(n, dtype=float)
    data["fault_count"] = np.zeros(n, dtype=np.int64)
    data["rul_s"] = np.full(n, np.nan, dtype=float)
    for col in SEV_COLUMNS:
        data[col] = np.zeros(n, dtype=float)


def compute_rul(t: np.ndarray, failure_s: np.ndarray, end_s: np.ndarray) -> np.ndarray:
    """Vectorised RUL for m faults over n time points -> shape (n,), NaN where undefined.

    failure_s : (m,) failure time of each fault, NaN if that fault never fails
    end_s     : (m,) time the fault is repaired/cleared, +inf if never
    """
    t = np.asarray(t, dtype=float)
    if len(failure_s) == 0:
        return np.full(t.shape, np.nan)
    rul = np.maximum(failure_s[:, None] - t[None, :], 0.0)             # (m, n)
    valid = ~np.isnan(failure_s)[:, None] & (t[None, :] < end_s[:, None])
    rul = np.where(valid, rul, np.inf)
    best = rul.min(axis=0)
    return np.where(np.isinf(best), np.nan, best)


def capped_rul(rul_s: np.ndarray | pd.Series, cap_s: float) -> np.ndarray:
    """Piece-wise linear RUL (standard in PdM): min(RUL, cap). NaN stays NaN."""
    return np.minimum(np.asarray(rul_s, dtype=float), cap_s)


def fault_segments(df: pd.DataFrame, merge_gap_s: float = 0.0, max_segments: int = 500,
                   profiles: dict[str, str] | None = None) -> list[dict]:
    """Contiguous stretches during which each fault is active, built from the sev_<type> columns.

    Faults are handled independently, so two simultaneous faults give two overlapping
    segments (nothing is hidden behind a "dominant" label). Intermittent faults give
    one segment per burst; pass merge_gap_s to join bursts closer than that many seconds.
    `profiles` maps fault type -> profile name (from the run config); the fault's
    default profile is used when it is missing.
    """
    from .faults import FAULT_TYPES      # late import: faults.py imports this module

    if len(df) == 0 or "t_s" not in df.columns:
        return []
    t = df["t_s"].to_numpy(dtype=float)
    segs: list[dict] = []
    for key in FAULT_KEYS:
        col = f"sev_{key}"
        if col not in df.columns:
            continue
        sev = df[col].to_numpy(dtype=float)
        act = sev > ACTIVE_THRESHOLD
        if not act.any():
            continue
        bounds = np.concatenate([[0], np.flatnonzero(np.diff(act.astype(np.int8))) + 1, [len(df)]])
        mine: list[dict] = []
        for a, b in zip(bounds[:-1], bounds[1:]):
            if not act[a]:
                continue
            seg = {
                "fault_type": key,
                "station": FAULT_TYPES[key].station,
                "profile": (profiles or {}).get(key, FAULT_TYPES[key].default_profile),
                "start_s": float(t[a]),
                "end_s": float(t[b - 1]),
                "peak_severity": round(float(sev[a:b].max()), 3),
                "n_samples": int(b - a),
            }
            if merge_gap_s > 0 and mine and seg["start_s"] - mine[-1]["end_s"] <= merge_gap_s:
                last = mine[-1]
                last["end_s"] = seg["end_s"]
                last["peak_severity"] = max(last["peak_severity"], seg["peak_severity"])
                last["n_samples"] += seg["n_samples"]
                last["merged_bursts"] = last.get("merged_bursts", 1) + 1
            else:
                mine.append(seg)
        segs.extend(mine)
    segs.sort(key=lambda x: (x["start_s"], x["fault_type"]))
    return segs[:max_segments]


def label_summary(df: pd.DataFrame) -> dict:
    """Compact label statistics stored with every run."""
    if "fault_active" not in df.columns or len(df) == 0:
        return {"active_fraction": 0.0, "rows_by_type": {}, "first_active_s": None,
                "min_rul_s": None, "n_segments": 0}
    active = df["fault_active"] == 1
    rows_by_type = {}
    for col in SEV_COLUMNS:
        if col in df.columns:
            n = int((df[col] > ACTIVE_THRESHOLD).sum())
            if n:
                rows_by_type[col.removeprefix("sev_")] = n
    rul = df["rul_s"].to_numpy(dtype=float)
    has_rul = ~np.isnan(rul)
    return {
        "active_fraction": round(float(active.mean()), 4),
        "rows_by_type": rows_by_type,
        "first_active_s": float(df.loc[active, "t_s"].iloc[0]) if active.any() else None,
        "min_rul_s": float(rul[has_rul].min()) if has_rul.any() else None,
        "n_segments": len(fault_segments(df)),
    }
