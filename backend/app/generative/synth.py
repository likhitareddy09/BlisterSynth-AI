"""Synthetic runs: physics supplies conditions + labels, a trained generator supplies the sensors."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from ..simulator import SENSOR_BY_KEY, STATIONS, LineSimulator, SimConfig, build_injector
from ..simulator.engine import HEALTH_EMA_S, health_score
from ..simulator.noise import first_order_lag
from ..simulator.sensors import POCKETS_PER_BLISTER
from .base import LEARNED, N_FAULT_START, POCKET_IDX, build_conditions, intensity_map


def postprocess(X: np.ndarray, C: np.ndarray) -> np.ndarray:
    """Hard physical limits: clip to sensor range, round like the real sensor, no pockets when stopped."""
    out = np.empty_like(X)
    for j, key in enumerate(LEARNED):
        spec = SENSOR_BY_KEY[key]
        out[:, j] = np.round(np.clip(X[:, j], spec.lo, spec.hi), spec.decimals)
    out[:, POCKET_IDX] = np.where(C[:, 0] > 0.05, np.clip(np.rint(X[:, POCKET_IDX]), 0, POCKETS_PER_BLISTER), 0)
    return out


def synthetic_health(cfg: SimConfig, data: pd.DataFrame, model, C: np.ndarray) -> pd.DataFrame:
    """Station health from z-scores against what the model expects for a *healthy* machine."""
    n, dt = len(data), 1.0 / cfg.sample_rate_hz
    C0 = C.copy()
    C0[:, N_FAULT_START:] = 0.0
    healthy = dict(zip(LEARNED, model.mean_physical(C0).T))
    healthy["line_speed_bpm"] = cfg.nominal_speed_bpm * C[:, 0]
    keys = [k for k in healthy if k != "pocket_fill_count"]
    cols = {}
    for k in keys:
        sd = SENSOR_BY_KEY[k].noise_sd * cfg.noise_scale
        tot = math.sqrt(sd**2 + (0.6 * sd * cfg.drift_scale) ** 2 + (0.35 * sd) ** 2) or 1.0
        cols[k] = (data[k].to_numpy(dtype=float) - healthy[k]) / tot
    running = C[:, 0] > 0.05
    cols["pocket_fill_count"] = np.where(running, POCKETS_PER_BLISTER - data["pocket_fill_count"].to_numpy(), 0.0) / 0.25
    a = math.exp(-dt / HEALTH_EMA_S)
    smooth = {k: first_order_lag(v, a, 0.0)[0] for k, v in cols.items()}
    out = {}
    for st in STATIONS:
        z = np.abs(np.vstack([smooth[s] for s in st["sensors"]])).max(axis=0)
        out[st["key"]] = np.round(health_score(z), 1)
    return pd.DataFrame(out)


def generate_run(model, cfg: SimConfig, faults: list[dict], gen_seed: int | None = None):
    """Returns (data, health, seed_used, injector). Same columns as a physics run."""
    injector = build_injector(faults, cfg.duration_s) if faults else None
    sim = LineSimulator(cfg, modifiers=[injector] if injector else None)
    phys, _ = sim.run()                       # labels, RUL, machine_state, shift, line_speed_bpm
    C = build_conditions(cfg, phys, intensity_map(injector.to_dicts() if injector else []))
    X = model.sample(C, seed=(sim.seed if gen_seed is None else gen_seed) + 101)
    data = phys.copy()
    data[LEARNED] = postprocess(X, C)
    return data, synthetic_health(cfg, data, model, C), sim.seed, injector


def quick_validation(model, seed: int = 4242) -> dict:
    """Healthy-machine fidelity against a fresh physics run (steady running rows only)."""
    cfg = SimConfig(duration_s=3600, seed=seed)
    phys, _ = LineSimulator(cfg).run()
    C = build_conditions(cfg, phys, {})
    X = postprocess(model.sample(C, seed=seed), C)
    mask = C[:, 0] > 0.99
    per = {}
    for j, key in enumerate(LEARNED):
        if key == "pocket_fill_count":
            continue
        p, g = phys[key].to_numpy()[mask], X[mask, j]
        per[key] = {"mean_err_sd": round(float((g.mean() - p.mean()) / (p.std() + 1e-9)), 3),
                    "std_ratio": round(float(g.std() / (p.std() + 1e-9)), 3)}
    return {"sensors": per,
            "max_abs_mean_err_sd": round(max(abs(v["mean_err_sd"]) for v in per.values()), 3),
            "median_std_ratio": round(float(np.median([v["std_ratio"] for v in per.values()])), 3)}
