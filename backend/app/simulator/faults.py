"""Fault injection: 8 fault types x 3 severity profiles, plugged into the engine hooks.

Two independent ideas are combined:

1. WHAT the fault does  (FaultType)   - a table of sensor shifts, oscillations and
   extra noise that apply at full severity. Faults are *data*, not code, so the
   catalogue, the API docs and the Phase 7 copilot can all describe them automatically.
2. WHEN it happens      (profile)     - a severity curve s(t) between 0 and 1:

       gradual       s = ((t - onset) / ramp)^power        wear-out; failure when s reaches 1
       sudden        s jumps 0 -> 1 within ~5 s at onset   hose burst, blocked line; failure = onset
       intermittent  random bursts that get longer and more frequent as the fault
                     matures; becomes permanent at onset + ramp (= failure time)

The effect on a sensor is   delta * s(t) * intensity * gate,  where `gate` switches
the effect off while the machine is stopped (e.g. vibration scales with speed).

Reproducibility: every fault instance owns its random streams, derived from
(run seed, fault index). They always draw the same amount of random numbers per
call, so batch generation and chunked live streaming stay bit-identical, and a
preview curve matches the real run for the same seed.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, fields, replace
from typing import Any

import numpy as np

from .labels import ACTIVE_THRESHOLD, FAULT_KEYS, NONE, compute_rul
from .noise import smoothstep
from .sensors import SENSOR_BY_KEY

PROFILES = ("gradual", "sudden", "intermittent")
PROFILE_DESCRIPTIONS = {
    "gradual": "Slow wear-out. Severity rises from 0 at onset to 1 at onset + ramp_s, where the fault fails.",
    "sudden": "Abrupt event (burst hose, blockage). Severity jumps to 1 within about 5 s of onset.",
    "intermittent": "Random bursts that become longer and more frequent as the fault matures, "
                    "then permanent at onset + ramp_s.",
}

SUDDEN_RISE_S = 5.0          # sudden faults reach full severity this fast
BURST_EDGE_S = 3.0           # intermittent bursts fade in/out over this long
PERMANENT_RISE_S = 30.0      # intermittent fault turns permanent over this long at failure time
MIN_GAP_S, MIN_BURST_S = 5.0, 5.0
MIN_RAMP_S = 60.0
STREAM_DEFAULT_RAMP_S = 900.0   # live-injected faults fail 15 min after injection by default


# --------------------------------------------------------------------------- fault types
@dataclass(frozen=True)
class FaultType:
    key: str
    label: str
    station: str
    description: str
    default_profile: str
    power: float                                   # exponent of the gradual curve (2 = accelerating wear)
    deltas: dict[str, tuple[float, str]]           # signal -> (shift at full severity, gate)
    osc: dict[str, float] = field(default_factory=dict)      # signal -> sine amplitude at full severity
    noise: dict[str, float] = field(default_factory=dict)    # sensor -> extra noise sd at full severity
    noise_gate: str = "none"

    @property
    def sensors(self) -> list[str]:
        keys = [k for k in {*self.deltas, *self.osc, *self.noise} if k in SENSOR_BY_KEY]
        return sorted(keys, key=list(SENSOR_BY_KEY).index)

    def signature(self) -> dict[str, str]:
        """Human-readable fingerprint at full severity, e.g. {'vib_x_mm_s': '+3.2 mm/s'}."""
        out: dict[str, str] = {}
        for key, (delta, _) in self.deltas.items():
            unit = SENSOR_BY_KEY[key].unit if key in SENSOR_BY_KEY else "per pocket"
            out[key] = f"{delta:+g} {unit}"
        for key, amp in self.osc.items():
            unit = SENSOR_BY_KEY[key].unit
            out[key] = (out[key] + f", oscillates ±{amp:g} {unit}") if key in out else f"oscillates ±{amp:g} {unit}"
        for key, sd in self.noise.items():
            out[key] = (out[key] + f", extra noise sd {sd:g}") if key in out else f"extra noise sd {sd:g}"
        return out

    def to_dict(self) -> dict[str, Any]:
        return {"key": self.key, "label": self.label, "station": self.station,
                "description": self.description, "default_profile": self.default_profile,
                "gradual_power": self.power, "sensors": self.sensors, "signature": self.signature()}


FAULT_TYPES: dict[str, FaultType] = {f.key: f for f in [
    FaultType(
        "bearing_wear", "Main drive bearing wear", "cartoning",
        "Bearing damage on the main drive: vibration climbs (accelerating), friction raises motor current.",
        "gradual", 2.0,
        deltas={"vib_x_mm_s": (3.2, "speed"), "vib_y_mm_s": (2.6, "speed"), "motor_current_a": (1.4, "speed")},
        noise={"vib_x_mm_s": 0.35, "vib_y_mm_s": 0.30}, noise_gate="speed"),
    FaultType(
        "sealing_heater_degradation", "Sealing heater degradation", "sealing",
        "Heater element ages and cannot reach set-point; the controller starts hunting.",
        "gradual", 1.0,
        deltas={"sealing_temp_c": (-14.0, "none")},
        noise={"sealing_temp_c": 1.2}),
    FaultType(
        "seal_pressure_leak", "Sealing pressure leak", "sealing",
        "Pneumatic leak: the sealing roller pressure sags and becomes unsteady.",
        "gradual", 1.0,
        deltas={"sealing_pressure_bar": (-2.0, "none")},
        noise={"sealing_pressure_bar": 0.15}),
    FaultType(
        "vacuum_leak", "Forming vacuum leak", "forming",
        "Leaking forming vacuum: pockets form badly, so the vision system rejects more of them.",
        "sudden", 1.0,
        deltas={"vacuum_kpa": (26.0, "none"), "pocket_miss_prob": (0.02, "running")},
        noise={"vacuum_kpa": 1.2}),
    FaultType(
        "film_tension_instability", "Film tension instability", "unwind",
        "Unwind brake/dancer fault: web tension oscillates and the drive current wobbles with it.",
        "intermittent", 1.0,
        deltas={"film_tension_n": (5.0, "running")},
        osc={"film_tension_n": 16.0, "motor_current_a": 0.5},
        noise={"film_tension_n": 1.0}, noise_gate="running"),
    FaultType(
        "cooling_blockage", "Cooling water blockage", "cooling",
        "Scaled or blocked cooling plates: flow falls and the sealing zone runs hotter.",
        "gradual", 1.0,
        deltas={"cooling_flow_lpm": (-9.0, "none"), "sealing_temp_c": (4.0, "none")},
        noise={"cooling_flow_lpm": 0.4}),
    FaultType(
        "punch_dulling", "Punching tool dulling", "punching",
        "Blunt punch: cutting force and vertical vibration rise, motor works harder.",
        "gradual", 1.5,
        deltas={"cutting_force_n": (380.0, "running"), "vib_z_mm_s": (1.5, "speed"),
                "motor_current_a": (0.6, "speed")},
        noise={"cutting_force_n": 25.0, "vib_z_mm_s": 0.12}, noise_gate="running"),
    FaultType(
        "pocket_feeder_jam", "Tablet feeder jamming", "filling",
        "Feeder skips tablets: empty pockets increase and the line speed becomes jittery.",
        "intermittent", 1.0,
        deltas={"pocket_miss_prob": (0.10, "running"), "line_speed_bpm": (-6.0, "running")},
        noise={"line_speed_bpm": 2.0}, noise_gate="running"),
]}


assert tuple(FAULT_TYPES) == FAULT_KEYS, "labels.FAULT_KEYS is out of sync with faults.FAULT_TYPES"


def _gate(kind: str, speed_frac: np.ndarray) -> np.ndarray | float:
    if kind == "speed":
        return 0.3 + 0.7 * speed_frac                       # effect grows with speed, never fully zero
    if kind == "running":
        return np.clip(speed_frac / 0.05, 0.0, 1.0)         # effect only while the machine runs
    return 1.0


# --------------------------------------------------------------------------- fault specification
@dataclass
class FaultSpec:
    type: str
    profile: str | None = None       # None -> the fault type's default profile
    onset_s: float = 0.0             # when the fault starts (seconds since run start)
    ramp_s: float | None = None      # onset -> failure time (gradual / intermittent). None -> until end of run
    end_s: float | None = None       # repair time: fault disappears. None -> persists
    intensity: float = 1.0           # multiplies the effect size (0.1 .. 3)
    gap_s: float = 600.0             # intermittent: typical pause between bursts early in life
    burst_s: float = 120.0           # intermittent: typical burst length early in life

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "FaultSpec":
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in d.items() if k in names and v is not None})

    def to_dict(self) -> dict[str, Any]:
        return {f.name: getattr(self, f.name) for f in fields(self)}


def resolve_spec(spec: FaultSpec, duration_s: float | None) -> FaultSpec:
    """Fill in the defaults (profile, ramp_s) and validate."""
    if spec.type not in FAULT_TYPES:
        raise ValueError(f"Unknown fault type '{spec.type}'. Known: {', '.join(FAULT_TYPES)}")
    profile = spec.profile or FAULT_TYPES[spec.type].default_profile
    if profile not in PROFILES:
        raise ValueError(f"Unknown profile '{profile}'. Known: {', '.join(PROFILES)}")
    ramp = spec.ramp_s
    if ramp is None:
        ramp = max(MIN_RAMP_S, duration_s - spec.onset_s) if duration_s else STREAM_DEFAULT_RAMP_S
    return replace(spec, profile=profile, ramp_s=float(ramp))


def failure_time(spec: FaultSpec) -> float | None:
    """When the fault reaches functional failure (RUL = 0); None if it is repaired first."""
    f = spec.onset_s if spec.profile == "sudden" else spec.onset_s + spec.ramp_s
    if spec.end_s is not None and spec.end_s <= f:
        return None
    return f


# --------------------------------------------------------------------------- intermittent schedule
class _Episodes:
    """Lazily generated list of random bursts. Draws are strictly sequential, so the
    schedule is identical no matter how the time axis is chunked."""

    def __init__(self, rng: np.random.Generator, spec: FaultSpec):
        self.rng, self.spec = rng, spec
        self.cursor = spec.onset_s
        self._starts: list[float] = []
        self._ends: list[float] = []
        self._amps: list[float] = []
        self._arrays: tuple[np.ndarray, np.ndarray, np.ndarray] | None = None

    def extend_to(self, t_max: float) -> None:
        sp = self.spec
        while self.cursor <= t_max:
            p = min(max((self.cursor - sp.onset_s) / sp.ramp_s, 0.0), 1.0)   # fault maturity
            gap = MIN_GAP_S + self.rng.exponential(sp.gap_s * (1.0 - 0.85 * p))
            burst = MIN_BURST_S + self.rng.exponential(sp.burst_s * (1.0 + 2.0 * p))
            amp = self.rng.uniform(0.6, 1.0)
            start = self.cursor + gap
            self._starts.append(start)
            self._ends.append(start + burst)
            self._amps.append(amp)
            self.cursor = start + burst
            self._arrays = None

    def arrays(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        if self._arrays is None:
            self._arrays = (np.asarray(self._starts), np.asarray(self._ends), np.asarray(self._amps))
        return self._arrays


# --------------------------------------------------------------------------- one active fault
class _FaultInstance:
    def __init__(self, index: int, spec: FaultSpec, seed: int):
        self.index, self.spec = index, spec
        self.ftype = FAULT_TYPES[spec.type]
        self.rng_noise = np.random.default_rng([seed, 20_000 + index])
        rng_par = np.random.default_rng([seed, 40_000 + index])
        self.period_s = float(rng_par.uniform(8.0, 25.0))        # oscillation period (tension fault)
        self.phase = float(rng_par.uniform(0.0, 2 * math.pi))
        self.episodes = (_Episodes(np.random.default_rng([seed, 30_000 + index]), spec)
                         if spec.profile == "intermittent" else None)

    @property
    def failure_s(self) -> float | None:
        return failure_time(self.spec)

    def severity(self, t: np.ndarray) -> np.ndarray:
        """Profile curve s(t) in [0, 1] (intensity not included)."""
        sp = self.spec
        if sp.profile == "gradual":
            s = np.clip((t - sp.onset_s) / sp.ramp_s, 0.0, 1.0) ** self.ftype.power
        elif sp.profile == "sudden":
            s = smoothstep((t - sp.onset_s) / SUDDEN_RISE_S)
        else:
            s = self._intermittent(t)
        if sp.end_s is not None:
            s = np.where(t >= sp.end_s, 0.0, s)
        return s

    def _intermittent(self, t: np.ndarray) -> np.ndarray:
        sp = self.spec
        self.episodes.extend_to(float(t.max()))
        starts, ends, amps = self.episodes.arrays()
        s = np.zeros_like(t, dtype=float)
        if len(starts):                       # none yet while the whole chunk lies before onset
            i = np.clip(np.searchsorted(starts, t, side="right") - 1, 0, None)
            inside = (t >= starts[i]) & (t < ends[i])
            env = np.minimum(smoothstep((t - starts[i]) / BURST_EDGE_S), smoothstep((ends[i] - t) / BURST_EDGE_S))
            maturity = np.clip((t - sp.onset_s) / sp.ramp_s, 0.0, 1.0)
            s = np.where(inside, env * amps[i] * (0.4 + 0.6 * maturity), 0.0)
        return np.maximum(s, smoothstep((t - (sp.onset_s + sp.ramp_s)) / PERMANENT_RISE_S))  # permanent at failure


# --------------------------------------------------------------------------- the engine modifier
class FaultInjector:
    """Engine modifier implementing physical(), measured() and annotate()."""

    def __init__(self, specs: list[FaultSpec | dict] | None = None, duration_s: float | None = None):
        self.duration_s = duration_s
        self.specs: list[FaultSpec] = []
        self.instances: list[_FaultInstance] = []
        self.seed: int | None = None
        for s in specs or []:
            spec = s if isinstance(s, FaultSpec) else FaultSpec.from_dict(s)
            self.specs.append(resolve_spec(spec, duration_s))

    # -- lifecycle ----------------------------------------------------------
    def bind(self, seed: int) -> None:
        """Called by LineSimulator once the run seed is known."""
        self.seed = int(seed)
        self.instances = [_FaultInstance(i, sp, self.seed) for i, sp in enumerate(self.specs)]

    def add(self, spec: FaultSpec | dict, onset_s: float | None = None) -> dict[str, Any]:
        """Inject another fault into a running simulation (live streaming demo)."""
        spec = spec if isinstance(spec, FaultSpec) else FaultSpec.from_dict(spec)
        if onset_s is not None:
            spec = replace(spec, onset_s=float(onset_s))
        spec = resolve_spec(spec, self.duration_s)
        self.specs.append(spec)
        if self.seed is not None:
            self.instances.append(_FaultInstance(len(self.instances), spec, self.seed))
        return self.to_dicts()[-1]

    def repair(self, now_s: float) -> int:
        """Maintenance event: every fault still acting (or scheduled) is cleared from `now_s`."""
        n = 0
        for inst in self.instances:
            if inst.spec.end_s is None or inst.spec.end_s > now_s:
                inst.spec.end_s = float(now_s)
                n += 1
        return n

    def to_dicts(self) -> list[dict[str, Any]]:
        out = []
        for i, sp in enumerate(self.specs):
            d = sp.to_dict()
            d["station"] = FAULT_TYPES[sp.type].station
            fs = failure_time(sp)
            d["failure_s"] = fs
            out.append(d)
        return out

    # -- curves (used by the preview endpoint and the labels) ---------------
    def severity_matrix(self, t: np.ndarray) -> np.ndarray:
        if not self.instances:
            return np.zeros((0, len(t)))
        return np.vstack([inst.severity(t) for inst in self.instances])

    def rul(self, t: np.ndarray) -> np.ndarray:
        fail = np.array([np.nan if i.failure_s is None else i.failure_s for i in self.instances], dtype=float)
        end = np.array([np.inf if i.spec.end_s is None else i.spec.end_s for i in self.instances], dtype=float)
        return compute_rul(t, fail, end)

    # -- engine hooks ---------------------------------------------------------
    def physical(self, ctx) -> None:
        sev = self.severity_matrix(ctx.t)
        ctx.extra["fault_sev"] = sev
        for inst, s in zip(self.instances, sev):
            if not s.any():
                continue
            ft, eff = inst.ftype, s * inst.spec.intensity
            for key, (delta, gate) in ft.deltas.items():
                ctx.signals[key] += delta * eff * _gate(gate, ctx.speed_frac)
            for key, amp in ft.osc.items():
                wave = np.sin(2 * math.pi * ctx.t / inst.period_s + inst.phase)
                ctx.signals[key] += amp * eff * wave * _gate("running", ctx.speed_frac)

    def measured(self, ctx, measured: dict[str, np.ndarray]) -> None:
        sev = ctx.extra["fault_sev"]
        n = len(ctx.t)
        for inst, s in zip(self.instances, sev):
            keys = list(inst.ftype.noise)
            draws = inst.rng_noise.standard_normal((n, len(keys)))   # always drawn -> chunk-independent
            if not s.any():
                continue
            eff = s * inst.spec.intensity * _gate(inst.ftype.noise_gate, ctx.speed_frac)
            for j, key in enumerate(keys):
                measured[key] = measured[key] + inst.ftype.noise[key] * eff * draws[:, j]

    def annotate(self, ctx, data) -> None:
        sev = ctx.extra["fault_sev"]
        if sev.shape[0] == 0:
            return
        n = len(ctx.t)
        cols = np.arange(n)
        intensity = np.array([i.spec.intensity for i in self.instances])
        types = np.array([i.spec.type for i in self.instances], dtype=object)
        stations = np.array([i.ftype.station for i in self.instances], dtype=object)
        profiles = np.array([i.spec.profile for i in self.instances], dtype=object)

        sev = np.round(sev, 3)                                           # labels are stored with 3 decimals
        active = sev > ACTIVE_THRESHOLD                                  # (m, n)
        any_active = active.any(axis=0)
        dom = (sev * intensity[:, None]).argmax(axis=0)                  # dominant = strongest effect

        data["fault_active"] = any_active.astype(np.int64)
        data["fault_type"] = np.where(any_active, types[dom], NONE)
        data["fault_station"] = np.where(any_active, stations[dom], NONE)
        data["fault_profile"] = np.where(any_active, profiles[dom], NONE)
        data["fault_severity"] = np.where(any_active, sev[dom, cols], 0.0)
        data["fault_count"] = active.sum(axis=0).astype(np.int64)
        data["rul_s"] = np.round(self.rul(ctx.t), 2)
        for key in FAULT_KEYS:                                           # multi-label ground truth
            mine = [i for i, inst in enumerate(self.instances) if inst.spec.type == key]
            if mine:
                data[f"sev_{key}"] = sev[mine].max(axis=0)


def build_injector(specs: list[dict | FaultSpec], duration_s: float | None) -> FaultInjector:
    return FaultInjector(specs, duration_s)


def catalog() -> dict[str, Any]:
    """Everything the UI / copilot needs to describe the available faults."""
    return {
        "fault_types": [f.to_dict() for f in FAULT_TYPES.values()],
        "profiles": [{"key": k, "description": v} for k, v in PROFILE_DESCRIPTIONS.items()],
        "active_threshold": ACTIVE_THRESHOLD,
        "defaults": {"onset_s": 0, "ramp_s": "until end of run", "end_s": None, "intensity": 1.0,
                     "gap_s": 600, "burst_s": 120},
    }
