"""The digital-twin engine: turns a SimConfig into realistic sensor time series.

Pipeline for every chunk of samples
-----------------------------------
1. Speed profile   : smooth ramp-up at start, ramp-down at stop, short speed dip
                     at every shift handover (06:00 / 14:00 / 22:00).
2. Environment     : room humidity follows a daily sine wave (peak ~15:00).
3. Physics         : each sensor's noise-free value is computed from speed and
                     humidity (e.g. motor current rises with speed, cutting force
                     falls slightly when humidity is high).
4. Modifiers hook  : fault injectors (see faults.py) edit the physical signals here,
                     add extra noise after step 6 and write the ground-truth label columns.
5. Thermal inertia : heater temperatures follow their targets with a first-order
                     lag (they cannot jump instantly).
6. Noise           : correlated AR(1) noise + slow calibration drift + a small
                     per-shift operator offset are added.
7. Vision count    : pocket fill count is drawn from a Binomial distribution.
8. Health          : each station gets a 0-100 health score from smoothed
                     z-scores of (measured - expected healthy value).

The engine keeps every filter state between chunks, so batch generation and
live WebSocket streaming produce *exactly* the same numbers for the same seed.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, fields
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from .labels import LABEL_COLUMNS, init_label_columns
from .noise import ar1_filter, build_correlation_matrix, cholesky_factor, first_order_lag, smoothstep
from .sensors import CONTINUOUS_KEYS, POCKETS_PER_BLISTER, SENSOR_BY_KEY, SENSORS, STATIONS

AMBIENT_C = 24.0
SHIFT_START_HOUR = 6.0             # shift A starts at 06:00
SHIFT_NAMES = ["A", "B", "C"]
SHIFT_DIP_S = 120.0                # handover slowdown length
SHIFT_DIP_DEPTH = 0.35             # speed drops to 65 % at the deepest point
DRIFT_TAU_S = 1800.0               # calibration drift wanders on a ~30 min scale
DRIFT_REL_SD = 0.6                 # drift size relative to noise sd
SHIFT_BIAS_REL_SD = 0.35           # operator/shift offset relative to noise sd
HEALTH_EMA_S = 10.0                # smoothing window of health z-scores
THERMAL = {                        # heater: (time constant s, cold-start deficit °C)
    "forming_temp_c": (120.0, 10.0),
    "sealing_temp_c": (90.0, 15.0),
}


@dataclass
class SimConfig:
    duration_s: int = 3600
    sample_rate_hz: float = 1.0
    seed: int | None = 42
    start_time: str = "2026-01-05T06:00:00"
    nominal_speed_bpm: float = 220.0
    include_startup: bool = True
    include_shutdown: bool = True
    rampup_s: float = 300.0
    rampdown_s: float = 180.0
    shift_hours: float = 8.0
    shift_change_dip: bool = True
    noise_scale: float = 1.0
    drift_scale: float = 1.0

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "SimConfig":
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in d.items() if k in names})

    def to_dict(self) -> dict[str, Any]:
        return {f.name: getattr(self, f.name) for f in fields(self)}


@dataclass
class ChunkContext:
    """Everything a modifier (fault injector) can see and change for one chunk."""
    t: np.ndarray                     # seconds since run start
    clock_h: np.ndarray               # hours since midnight of the start date
    speed_frac: np.ndarray            # 0..1 fraction of nominal speed (editable)
    signals: dict[str, np.ndarray]    # noise-free physical signals (editable)
    rng: np.random.Generator          # dedicated random stream for modifiers
    dt: float
    extra: dict[str, Any] = field(default_factory=dict)


def health_score(max_abs_z: np.ndarray) -> np.ndarray:
    """100 while |z| <= 2, then falls smoothly: |z|=3.5 -> ~61, |z|=5 -> ~14."""
    excess = np.clip(max_abs_z - 2.0, 0.0, None)
    return 100.0 * np.exp(-0.5 * (excess / 1.5) ** 2)


def health_status(score: float) -> str:
    return "green" if score >= 80 else ("amber" if score >= 50 else "red")


class LineSimulator:
    """Stateful generator. Call `run()` for a full batch or `generate(n)` repeatedly to stream."""

    def __init__(self, config: SimConfig | None = None, modifiers: list | None = None,
                 streaming: bool = False):
        self.cfg = config or SimConfig()
        self.modifiers = list(modifiers or [])
        self.streaming = streaming
        cfg = self.cfg

        self.dt = 1.0 / float(cfg.sample_rate_hz)
        self.total_s = None if streaming else float(cfg.duration_s)
        self.n_total = None if streaming else int(round(cfg.duration_s * cfg.sample_rate_hz))

        # Reproducibility: record the seed actually used, even if none was given.
        self.seed = int(cfg.seed) if cfg.seed is not None else int(np.random.SeedSequence().entropy % (2**31))
        s_innov, s_drift, s_fill, s_init, s_mod = np.random.SeedSequence(self.seed).spawn(5)
        self.rng_innov = np.random.default_rng(s_innov)
        self.rng_drift = np.random.default_rng(s_drift)
        self.rng_fill = np.random.default_rng(s_fill)
        self.rng_mod = np.random.default_rng(s_mod)
        rng_init = np.random.default_rng(s_init)
        for m in self.modifiers:                  # give fault injectors the run seed (reproducible faults)
            if hasattr(m, "bind"):
                m.bind(self.seed)

        self.start = datetime.fromisoformat(cfg.start_time)
        self.clock0_h = self.start.hour + self.start.minute / 60 + self.start.second / 3600

        # Noise parameters, converted from "per second" to the actual sample period.
        self.keys = CONTINUOUS_KEYS
        k = len(self.keys)
        self.sd = np.array([SENSOR_BY_KEY[s].noise_sd for s in self.keys]) * cfg.noise_scale
        self.phi = np.array([SENSOR_BY_KEY[s].phi for s in self.keys]) ** self.dt
        self.L = cholesky_factor(build_correlation_matrix(self.keys))
        self.phi_drift = math.exp(-self.dt / DRIFT_TAU_S)
        self.sd_drift = DRIFT_REL_SD * self.sd * cfg.drift_scale
        self.sd_total = np.sqrt(self.sd**2 + self.sd_drift**2 + (SHIFT_BIAS_REL_SD * self.sd) ** 2)
        self.sd_total = np.where(self.sd_total > 0, self.sd_total, 1.0)

        # Filter memories start in their stationary distribution (no warm-up artefact).
        self.zi_noise = self.phi * rng_init.standard_normal(k) * self.sd
        self.zi_drift = self.phi_drift * rng_init.standard_normal(k) * self.sd_drift

        # Heater state: cold start (still pre-heating) or already at temperature.
        self.zi_thermal: dict[str, float] = {}
        self.zi_thermal_expected: dict[str, float] = {}
        for name, (tau, deficit) in THERMAL.items():
            a = math.exp(-self.dt / tau)
            y0 = SENSOR_BY_KEY[name].nominal - (deficit if cfg.include_startup else 0.0)
            self.zi_thermal[name] = a * y0
            self.zi_thermal_expected[name] = a * y0

        # Health smoothing memory: one channel per continuous sensor + pocket misses.
        self.a_health = math.exp(-self.dt / HEALTH_EMA_S)
        self.zi_health = np.zeros(k + 1)

        self._index = 0
        self._shift_bias: dict[int, np.ndarray] = {}

    # ------------------------------------------------------------------ public API
    @property
    def time_s(self) -> float:
        """Simulated time (seconds since run start) of the next sample to be generated."""
        return self._index * self.dt

    @property
    def done(self) -> bool:
        return self.n_total is not None and self._index >= self.n_total

    def run(self, chunk: int = 3600) -> tuple[pd.DataFrame, pd.DataFrame]:
        """Generate the whole configured duration. Returns (data, station_health)."""
        if self.n_total is None:
            raise ValueError("run() needs a finite duration; use generate() for streaming")
        datas, healths = [], []
        while not self.done:
            n = min(chunk, self.n_total - self._index)
            d, h = self.generate(n)
            datas.append(d)
            healths.append(h)
        return pd.concat(datas, ignore_index=True), pd.concat(healths, ignore_index=True)

    def generate(self, n: int) -> tuple[pd.DataFrame, pd.DataFrame]:
        """Generate the next `n` samples, continuing exactly where the last call stopped."""
        if self.n_total is not None:
            n = min(n, self.n_total - self._index)
        if n <= 0:
            return self._empty()
        cfg = self.cfg
        idx = np.arange(self._index, self._index + n)
        t = idx * self.dt
        clock_h = self.clock0_h + t / 3600.0

        f, state = self._speed_profile(t, clock_h)
        humidity = 45.0 + 4.0 * np.sin(2 * np.pi * (clock_h - 9.0) / 24.0)
        phys = self._physics(f, humidity)
        expected = {key: v.copy() for key, v in phys.items()}

        ctx = ChunkContext(t=t, clock_h=clock_h, speed_frac=f.copy(), signals=phys,
                           rng=self.rng_mod, dt=self.dt)
        for m in self.modifiers:
            if hasattr(m, "physical"):
                m.physical(ctx)

        # Thermal inertia (applied to both the actual and the healthy-expected signal)
        for name, (tau, _) in THERMAL.items():
            a = math.exp(-self.dt / tau)
            phys[name], self.zi_thermal[name] = first_order_lag(phys[name], a, self.zi_thermal[name])
            expected[name], self.zi_thermal_expected[name] = first_order_lag(
                expected[name], a, self.zi_thermal_expected[name])

        # Correlated AR(1) noise + drift + shift offsets
        k = len(self.keys)
        shocks = self.rng_innov.standard_normal((n, k)) @ self.L.T
        drift_shocks = self.rng_drift.standard_normal((n, k))
        noise = np.empty((n, k))
        drift = np.empty((n, k))
        for j in range(k):
            noise[:, j], self.zi_noise[j] = ar1_filter(shocks[:, j], self.phi[j], self.sd[j], self.zi_noise[j])
            drift[:, j], self.zi_drift[j] = ar1_filter(drift_shocks[:, j], self.phi_drift,
                                                       self.sd_drift[j], self.zi_drift[j])
        shift_idx = np.floor((clock_h - SHIFT_START_HOUR) / cfg.shift_hours).astype(int)
        bias = np.vstack([self._bias_for_shift(s) for s in shift_idx])

        running_gate = np.clip(f / 0.05, 0.0, 1.0)
        measured: dict[str, np.ndarray] = {}
        for j, key in enumerate(self.keys):
            gate = 1.0
            if key in ("line_speed_bpm", "cutting_force_n"):
                gate = running_gate                      # encoder/load cell read ~0 when stopped
            elif key.startswith("vib_"):
                gate = 0.3 + 0.7 * f
            elif key == "motor_current_a":
                gate = 0.5 + 0.5 * f
            measured[key] = phys[key] + (noise[:, j] + drift[:, j] + bias[:, j]) * gate

        for m in self.modifiers:
            if hasattr(m, "measured"):
                m.measured(ctx, measured)

        # Vision system: each of the 10 pockets is missed with probability p
        running = f > 0.05
        p_miss = np.clip(phys["pocket_miss_prob"], 0.0, 1.0)
        misses = self.rng_fill.binomial(POCKETS_PER_BLISTER, p_miss)
        measured["pocket_fill_count"] = np.where(running, POCKETS_PER_BLISTER - misses, 0).astype(float)

        for key in measured:
            spec = SENSOR_BY_KEY[key]
            measured[key] = np.round(np.clip(measured[key], spec.lo, spec.hi), spec.decimals)

        data = pd.DataFrame({
            "timestamp": (pd.Timestamp(self.start) + pd.to_timedelta(t, unit="s")).strftime("%Y-%m-%dT%H:%M:%S.%f").str[:-3],
            "t_s": np.round(t, 3),
            "shift": [SHIFT_NAMES[s % 3] for s in shift_idx],
            "machine_state": state,
            **{s.key: measured[s.key] for s in SENSORS},
        })

        init_label_columns(data)                  # healthy labels; fault modifiers overwrite them
        health = self._health(measured, expected, running, n)
        ctx.extra["health"] = health
        for m in self.modifiers:
            if hasattr(m, "annotate"):
                m.annotate(ctx, data)

        self._index += n
        return data, health

    # ------------------------------------------------------------------ internals
    def _empty(self) -> tuple[pd.DataFrame, pd.DataFrame]:
        cols = ["timestamp", "t_s", "shift", "machine_state"] + [s.key for s in SENSORS] + LABEL_COLUMNS
        return pd.DataFrame(columns=cols), pd.DataFrame(columns=[s["key"] for s in STATIONS])

    def _speed_profile(self, t: np.ndarray, clock_h: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        cfg = self.cfg
        f = np.ones_like(t)
        state = np.full(t.shape, "running", dtype=object)

        if cfg.include_startup and cfg.rampup_s > 0:
            f *= smoothstep(t / cfg.rampup_s)
            state[t < cfg.rampup_s] = "ramp_up"

        if cfg.include_shutdown and self.total_s is not None and cfg.rampdown_s > 0:
            remaining = (self.total_s - self.dt) - t
            f *= smoothstep(remaining / cfg.rampdown_s)
            state[remaining < cfg.rampdown_s] = "ramp_down"

        if cfg.shift_change_dip:
            since = ((clock_h - SHIFT_START_HOUR) % cfg.shift_hours) * 3600.0
            in_dip = (t > since) & (since < SHIFT_DIP_S)       # a handover happened during this run
            f[in_dip] *= 1.0 - SHIFT_DIP_DEPTH * np.sin(np.pi * since[in_dip] / SHIFT_DIP_S)
            state[in_dip & (state == "running")] = "shift_change"

        state[f < 0.02] = "stopped"
        return f, state

    def _physics(self, f: np.ndarray, humidity: np.ndarray) -> dict[str, np.ndarray]:
        """Noise-free value of every sensor given speed fraction f and humidity."""
        cfg = self.cfg
        gate = np.clip(f / 0.05, 0.0, 1.0)
        dh = humidity - 45.0
        return {
            # Heater targets (temperature dips slightly as more film absorbs heat at speed)
            "forming_temp_c": 135.0 - 1.5 * f,
            "sealing_temp_c": 180.0 - 2.5 * f - 0.04 * dh,
            "sealing_pressure_bar": 4.5 * (0.92 + 0.08 * f),
            "film_tension_n": 120.0 * (0.35 + 0.65 * f),
            "vacuum_kpa": -80.0 + 0.05 * dh,                       # humid air -> slightly weaker vacuum
            "motor_current_a": 2.5 + 9.5 * f,                     # idle current + load proportional to speed
            "vib_x_mm_s": 0.15 + 1.65 * f**1.2,
            "vib_y_mm_s": 0.12 + 1.38 * f**1.2,
            "vib_z_mm_s": 0.10 + 1.10 * f**1.2,
            "line_speed_bpm": cfg.nominal_speed_bpm * f,
            "cooling_flow_lpm": np.full_like(f, 18.0),
            "humidity_pct": humidity,
            "cutting_force_n": gate * (850.0 - 1.2 * dh),         # moist foil cuts a little easier
            "pocket_miss_prob": 0.0015 + 0.003 * f,               # faster line -> slightly more misses
        }

    def _bias_for_shift(self, shift_idx: int) -> np.ndarray:
        if shift_idx not in self._shift_bias:
            rng = np.random.default_rng([self.seed, shift_idx + 10_000])
            self._shift_bias[shift_idx] = rng.standard_normal(len(self.keys)) * SHIFT_BIAS_REL_SD * self.sd
        return self._shift_bias[shift_idx]

    def _health(self, measured: dict, expected: dict, running: np.ndarray, n: int) -> pd.DataFrame:
        k = len(self.keys)
        z = np.empty((n, k + 1))
        for j, key in enumerate(self.keys):
            z[:, j] = (measured[key] - expected[key]) / self.sd_total[j]
        misses = np.where(running, POCKETS_PER_BLISTER - measured["pocket_fill_count"], 0.0)
        z[:, k] = misses / 0.25                        # ~0.04 misses/blister is normal
        smooth = np.empty_like(z)
        a = self.a_health
        for j in range(k + 1):
            smooth[:, j], self.zi_health[j] = first_order_lag(z[:, j], a, self.zi_health[j])

        col = {key: j for j, key in enumerate(self.keys)}
        col["pocket_fill_count"] = k
        out = {}
        for st in STATIONS:
            cols = [col[s] for s in st["sensors"]]
            out[st["key"]] = np.round(health_score(np.abs(smooth[:, cols]).max(axis=1)), 1)
        return pd.DataFrame(out)
