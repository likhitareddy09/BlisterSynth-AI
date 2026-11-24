"""Window features for predictive maintenance: rolling mean / std / delta of every sensor."""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..simulator import SENSORS

SENSOR_KEYS = [s.key for s in SENSORS]


def window_features(df: pd.DataFrame, window_s: float = 60.0, stride_s: float = 30.0,
                    nominal: float = 220.0) -> tuple[pd.DataFrame, np.ndarray]:
    """One feature row per `stride_s`, each looking back `window_s`.

    Per sensor: __mean, __std and __delta (mean now minus mean one window earlier = trend),
    plus speed_frac. Returns (features, row positions in df of each window's last sample).
    """
    t = df["t_s"].to_numpy(dtype=float)
    dt = float(np.median(np.diff(t))) if len(t) > 1 else 1.0
    w = max(5, int(round(window_s / dt)))
    stride = max(1, int(round(stride_s / dt)))
    if len(df) < 2 * w + 1:
        raise ValueError(f"run too short: need more than {2 * w} samples for a {window_s:g}s window")
    cols: dict[str, pd.Series] = {}
    for key in SENSOR_KEYS:
        roll = df[key].astype(float).rolling(w)
        m = roll.mean()
        cols[f"{key}__mean"], cols[f"{key}__std"], cols[f"{key}__delta"] = m, roll.std(), m - m.shift(w)
    feats = pd.DataFrame(cols)
    feats["speed_frac"] = df["line_speed_bpm"].astype(float).rolling(w).mean() / nominal
    idx = np.arange(2 * w - 1, len(df), stride)
    return feats.iloc[idx].reset_index(drop=True), idx
