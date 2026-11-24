"""Shared pieces for the Phase 3 generators: features, conditions, seed data, scalers.

Design in one paragraph
-----------------------
A generator learns  sensors | condition  where the condition vector (COND_COLS) comes from the
physics layer: speed fraction, humidity phase, two heater warm-up factors and the 8 fault
severities (severity x intensity).  Speed is therefore never *generated*: the physics speed
profile is deterministic, so it is passed in as a condition, and `line_speed_bpm` plus
`machine_state` are copied from the physics run.  The generators learn how every other
sensor responds to that condition, including the noise.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd
import torch
from torch import nn

from ..simulator import FAULT_KEYS, PROFILES, SEV_COLUMNS, SENSOR_BY_KEY, SENSORS, LineSimulator, SimConfig, build_injector

# Every sensor except line_speed_bpm is generated (speed is a condition, see module docstring).
LEARNED: list[str] = [s.key for s in SENSORS if s.key != "line_speed_bpm"]
COND_COLS: list[str] = ["speed_frac", "humidity_dev", "warm_form", "warm_seal", *SEV_COLUMNS]
N_X, N_C = len(LEARNED), len(COND_COLS)
N_FAULT_START = 4                       # first severity column inside COND_COLS
POCKET_IDX = LEARNED.index("pocket_fill_count")
# "One noise unit" per sensor: residuals are measured in these units. The vision count has no
# Gaussian noise in the spec, so it gets a small fixed unit.
NOISE_UNIT = np.array([SENSOR_BY_KEY[k].noise_sd or 0.3 for k in LEARNED], dtype=np.float64)


class SeedCancelled(Exception):
    """Raised by progress callbacks to stop a training job."""


def mlp(i: int, h: int, o: int, depth: int = 2) -> nn.Sequential:
    layers: list[nn.Module] = []
    d = i
    for _ in range(depth):
        layers += [nn.Linear(d, h), nn.SiLU()]
        d = h
    layers.append(nn.Linear(d, o))
    return nn.Sequential(*layers)


def set_threads() -> None:
    import os
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))


# ------------------------------------------------------------------------------ conditions
def intensity_map(fault_dicts: list[dict]) -> dict[str, float]:
    out: dict[str, float] = {}
    for f in fault_dicts:
        out[f["type"]] = max(out.get(f["type"], 0.0), float(f.get("intensity", 1.0)))
    return out


def build_conditions(cfg: SimConfig, data: pd.DataFrame, intensities: dict[str, float]) -> np.ndarray:
    """Condition matrix (n, N_C) for a physics run `data` made with `cfg`."""
    t = data["t_s"].to_numpy(dtype=float)
    sim = LineSimulator(cfg)
    clock_h = sim.clock0_h + t / 3600.0
    f, _ = sim._speed_profile(t, clock_h)                     # deterministic physics speed profile
    hum = np.sin(2 * np.pi * (clock_h - 9.0) / 24.0)          # humidity = 45 + 4*hum
    if cfg.include_startup:
        wf, ws = np.exp(-t / 120.0), np.exp(-t / 90.0)        # heater cold-start deficits decay
    else:
        wf = ws = np.zeros_like(t)
    mult = np.array([intensities.get(k, 1.0) for k in FAULT_KEYS])
    sev = data[SEV_COLUMNS].to_numpy(dtype=float) * mult
    return np.column_stack([f, hum, wf, ws, sev]).astype(np.float32)


# ------------------------------------------------------------------------------ seed data
@dataclass
class SeedSet:
    X: np.ndarray                      # (n, N_X) sensor values
    C: np.ndarray                      # (n, N_C) conditions
    bounds: list[tuple[int, int]]      # row range of every seed run

    @property
    def n_rows(self) -> int:
        return len(self.X)


def build_seed_set(n_runs: int, duration_s: int, seed: int, progress=None) -> SeedSet:
    """A small physics seed set: healthy runs plus runs with 1-2 faults of every type/profile."""
    rng = np.random.default_rng(seed)
    Xs, Cs, bounds, pos = [], [], [], 0
    n_made = 0                                               # faults created so far (cycles through all types)
    for i in range(n_runs):
        up_lo, up_hi = min(300.0, 0.25 * duration_s), min(900.0, 0.4 * duration_s)
        dn_lo, dn_hi = min(180.0, 0.15 * duration_s), min(400.0, 0.2 * duration_s)
        cfg = SimConfig(
            duration_s=duration_s, sample_rate_hz=1.0, seed=int(rng.integers(1, 2**31 - 1)),
            start_time=f"2026-01-05T{int(rng.integers(0, 24)):02d}:{int(rng.integers(0, 60)):02d}:00",
            rampup_s=float(rng.uniform(up_lo, up_hi)), rampdown_s=float(rng.uniform(dn_lo, dn_hi)),
            include_startup=bool(rng.random() < 0.9), include_shutdown=True)
        faults: list[dict] = []
        if i % 4 != 0:                                       # every 4th run stays healthy
            for j in range(1 if rng.random() < 0.7 else 2):
                onset = float(rng.uniform(0, 0.5 * duration_s))
                faults.append({
                    "type": FAULT_KEYS[n_made % len(FAULT_KEYS)],
                    "profile": str(rng.choice(PROFILES)) if rng.random() < 0.4 else None,
                    "onset_s": onset,
                    "ramp_s": max(120.0, float(rng.uniform(0.2, 0.8)) * (duration_s - onset)),
                    "intensity": float(rng.uniform(0.7, 1.5)),
                    "gap_s": float(rng.uniform(60, 300)), "burst_s": float(rng.uniform(30, 120)),
                })
                n_made += 1
        inj = build_injector(faults, cfg.duration_s) if faults else None
        data, _ = LineSimulator(cfg, modifiers=[inj] if inj else None).run()
        C = build_conditions(cfg, data, intensity_map(inj.to_dicts() if inj else []))
        Xs.append(data[LEARNED].to_numpy(dtype=np.float32))
        Cs.append(C)
        bounds.append((pos, pos + len(data)))
        pos += len(data)
        if progress:
            progress(i + 1, n_runs)
    return SeedSet(np.vstack(Xs), np.vstack(Cs), bounds)


def seed_set_from_runs(runs: list[dict]) -> SeedSet:
    """Build a seed set from saved *physics* runs (rows of the `runs` table)."""
    Xs, Cs, bounds, pos = [], [], [], 0
    for run in runs:
        full = pd.read_csv(run["file_path"])
        cfg = SimConfig.from_dict(run["config"])
        Cs.append(build_conditions(cfg, full, intensity_map(run["config"].get("faults", []))))
        Xs.append(full[LEARNED].to_numpy(dtype=np.float32))
        bounds.append((pos, pos + len(full)))
        pos += len(full)
    return SeedSet(np.vstack(Xs), np.vstack(Cs), bounds)


def seed_set_from_datasets(datasets: list[dict]) -> SeedSet:
    """Phase 7: seed set from uploaded datasets (rows of the `datasets` table).

    Conditions: the real speed (line_speed_bpm / nominal), humidity phase from the clock, no heater warm-up
    deficit (unknown for real data) and the severity columns (all zero for unlabeled data -> the generator
    then learns the *healthy* behaviour of the uploaded machine).
    """
    Xs, Cs, bounds, pos = [], [], [], 0
    for ds in datasets:
        full = pd.read_csv(ds["file_path"])
        nominal = float(full.loc[full["machine_state"] == "running", "line_speed_bpm"].median()) if (full["machine_state"] == "running").any() \
            else float(full["line_speed_bpm"].max() or 220.0)
        nominal = min(400.0, max(50.0, nominal or 220.0))
        cfg = SimConfig(duration_s=int(max(60, full["t_s"].iloc[-1])), sample_rate_hz=float(ds.get("sample_rate_hz") or 1.0),
                        nominal_speed_bpm=nominal, include_startup=False)
        C = build_conditions(cfg, full, {})
        C[:, 0] = np.clip(full["line_speed_bpm"].to_numpy(dtype=float) / nominal, 0.0, 1.5)
        Cs.append(C)
        Xs.append(full[LEARNED].to_numpy(dtype=np.float32))
        bounds.append((pos, pos + len(full)))
        pos += len(full)
    return SeedSet(np.vstack(Xs), np.vstack(Cs), bounds)


# ------------------------------------------------------------------------------ scaling
@dataclass
class Scaler:
    mu: np.ndarray       # per-sensor centre
    g: np.ndarray        # per-sensor global std (scale for the mean network)
    s: np.ndarray        # per-sensor noise unit (scale for the residual)

    @classmethod
    def fit(cls, X: np.ndarray) -> "Scaler":
        return cls(X.mean(0).astype(np.float64), X.std(0).astype(np.float64) + 1e-6, NOISE_UNIT.copy())

    def to_dict(self) -> dict:
        return {"mu": self.mu, "g": self.g, "s": self.s}

    @classmethod
    def from_dict(cls, d: dict) -> "Scaler":
        return cls(np.asarray(d["mu"]), np.asarray(d["g"]), np.asarray(d["s"]))


def train_mean_net(net: nn.Module, Xs: torch.Tensor, C: torch.Tensor, epochs: int, lr: float = 2e-3,
                   batch: int = 512, tick=None) -> None:
    """Fit the conditional mean (standardised units) with plain MSE."""
    opt = torch.optim.Adam(net.parameters(), lr=lr)
    n = len(Xs)
    for ep in range(epochs):
        perm = torch.randperm(n)
        for k in range(0, n, batch):
            idx = perm[k:k + batch]
            loss = ((net(C[idx]) - Xs[idx]) ** 2).mean()
            opt.zero_grad()
            loss.backward()
            opt.step()
        if tick:
            tick(ep + 1, float(loss.detach()))


class GenBase:
    """Common interface of the generators: mean_physical(C) and sample(C, seed)."""
    kind = "base"
    scaler: Scaler
    mean_net: nn.Module

    def mean_physical(self, C: np.ndarray) -> np.ndarray:
        with torch.no_grad():
            m = self.mean_net(torch.as_tensor(C, dtype=torch.float32)).numpy().astype(np.float64)
        return self.scaler.mu + self.scaler.g * m

    def sample(self, C: np.ndarray, seed: int = 0) -> np.ndarray:    # pragma: no cover
        raise NotImplementedError
