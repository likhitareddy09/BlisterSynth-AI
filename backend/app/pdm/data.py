"""Scenario generation for PdM experiments: physics runs, or runs whose sensors come from a generator."""
from __future__ import annotations

import numpy as np

from ..simulator import FAULT_KEYS, PROFILES, LineSimulator, SimConfig, build_injector


def make_scenarios(n: int, duration_s: int, seed: int) -> list[tuple[SimConfig, list[dict]]]:
    """Every 4th run healthy; the others get 1-2 faults, cycling through all 8 types and 3 profiles."""
    rng = np.random.default_rng(seed)
    out, n_made = [], 0
    for i in range(n):
        up_lo, up_hi = min(300.0, 0.25 * duration_s), min(900.0, 0.4 * duration_s)
        dn_lo, dn_hi = min(180.0, 0.15 * duration_s), min(400.0, 0.2 * duration_s)
        cfg = SimConfig(duration_s=duration_s, seed=int(rng.integers(1, 2**31 - 1)),
                        start_time=f"2026-01-05T{int(rng.integers(0, 24)):02d}:{int(rng.integers(0, 60)):02d}:00",
                        rampup_s=float(rng.uniform(up_lo, up_hi)), rampdown_s=float(rng.uniform(dn_lo, dn_hi)))
        faults: list[dict] = []
        if i % 4 != 0:
            for _ in range(1 if rng.random() < 0.7 else 2):
                onset = float(rng.uniform(0.1, 0.5) * duration_s)
                faults.append({"type": FAULT_KEYS[n_made % len(FAULT_KEYS)],
                               "profile": str(rng.choice(PROFILES)) if rng.random() < 0.4 else None,
                               "onset_s": onset, "ramp_s": max(120.0, float(rng.uniform(0.2, 0.8)) * (duration_s - onset)),
                               "intensity": float(rng.uniform(0.7, 1.5)),
                               "gap_s": float(rng.uniform(60, 300)), "burst_s": float(rng.uniform(30, 120))})
                n_made += 1
        out.append((cfg, faults))
    return out


def make_runs(scenarios, model=None) -> list[dict]:
    """Physics runs (model=None) or synthetic runs from a trained generator. Labels always come from physics."""
    from ..generative.synth import generate_run
    runs = []
    for cfg, faults in scenarios:
        if model is None:
            inj = build_injector(faults, cfg.duration_s) if faults else None
            df, _ = LineSimulator(cfg, modifiers=[inj] if inj else None).run()
            resolved = inj.to_dicts() if inj else []
        else:
            df, _, _, inj = generate_run(model, cfg, faults)
            resolved = inj.to_dicts() if inj else []
        runs.append({"df": df, "cfg": cfg, "faults": resolved})
    return runs


def make_imbalanced_scenarios(n: int, duration_s: int, seed: int, n_fault_runs: int = 2) -> list[tuple[SimConfig, list[dict]]]:
    """Phase 7 "imbalance fix" experiment: like make_scenarios, but only the first `n_fault_runs` faulty runs keep their
    faults; every other run is healthy. This mimics a plant that has run mostly without failures."""
    out, kept = [], 0
    for cfg, faults in make_scenarios(n, duration_s, seed):
        if faults and kept < n_fault_runs:
            kept += 1
            out.append((cfg, faults))
        else:
            out.append((cfg, []))
    return out
