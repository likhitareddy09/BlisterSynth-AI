"""Pydantic request/response models. They validate input and document the API at /docs."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from .config import MAX_DURATION_S, MAX_ROWS, MAX_SAMPLE_RATE_HZ
from .simulator.faults import FAULT_TYPES, PROFILES

# Literal types built from the catalogue, so /docs shows the allowed values as a dropdown.
FaultTypeName = Literal[tuple(FAULT_TYPES)]   # type: ignore[valid-type]
ProfileName = Literal[tuple(PROFILES)]        # type: ignore[valid-type]
MAX_FAULTS = 8


class SimConfigIn(BaseModel):
    duration_s: int = Field(3600, ge=60, le=MAX_DURATION_S, description="Length of the run in seconds")
    sample_rate_hz: float = Field(1.0, gt=0, le=MAX_SAMPLE_RATE_HZ)
    seed: int | None = Field(42, description="Same seed -> identical data. null = random")
    start_time: str = Field("2026-01-05T06:00:00", description="ISO start timestamp (local plant time)")
    nominal_speed_bpm: float = Field(220.0, ge=50, le=400)
    include_startup: bool = True
    include_shutdown: bool = True
    rampup_s: float = Field(300.0, ge=0, le=3600)
    rampdown_s: float = Field(180.0, ge=0, le=3600)
    shift_hours: float = Field(8.0, ge=1, le=24)
    shift_change_dip: bool = True
    noise_scale: float = Field(1.0, ge=0, le=5)
    drift_scale: float = Field(1.0, ge=0, le=5)

    @model_validator(mode="after")
    def check_rows(self):
        if self.duration_s * self.sample_rate_hz > MAX_ROWS:
            raise ValueError(f"duration_s x sample_rate_hz must be <= {MAX_ROWS} rows")
        if self.include_startup and self.include_shutdown and self.rampup_s + self.rampdown_s > self.duration_s:
            raise ValueError("rampup_s + rampdown_s is longer than the run")
        return self


class FaultSpecIn(BaseModel):
    type: FaultTypeName
    profile: ProfileName | None = Field(None, description="null = the fault type's default profile")
    onset_s: float = Field(0, ge=0, le=MAX_DURATION_S, description="When the fault starts (s since run start)")
    ramp_s: float | None = Field(None, ge=10, le=MAX_DURATION_S,
                                 description="Onset -> failure time for gradual/intermittent faults. "
                                             "null = until the end of the run (run-to-failure)")
    end_s: float | None = Field(None, gt=0, description="Repair time: the fault disappears. null = persists")
    intensity: float = Field(1.0, ge=0.1, le=3.0, description="Multiplies the effect size")
    gap_s: float = Field(600, ge=20, le=MAX_DURATION_S, description="Intermittent: typical pause between bursts")
    burst_s: float = Field(120, ge=10, le=MAX_DURATION_S, description="Intermittent: typical burst length")

    @model_validator(mode="after")
    def check_window(self):
        if self.end_s is not None and self.end_s <= self.onset_s:
            raise ValueError("end_s must be later than onset_s")
        return self


class SimulateRequest(BaseModel):
    name: str = Field("Physics run", max_length=120)
    config: SimConfigIn = Field(default_factory=SimConfigIn)
    faults: list[FaultSpecIn] = Field(default_factory=list, max_length=MAX_FAULTS,
                                      description="Faults to inject. Empty = healthy run")

    @model_validator(mode="after")
    def check_faults(self):
        for f in self.faults:
            if f.onset_s >= self.config.duration_s:
                raise ValueError(f"fault '{f.type}' starts at {f.onset_s}s, after the run ends "
                                 f"({self.config.duration_s}s)")
        return self


class FaultPreviewRequest(BaseModel):
    faults: list[FaultSpecIn] = Field(..., min_length=1, max_length=MAX_FAULTS)
    duration_s: int = Field(3600, ge=60, le=MAX_DURATION_S)
    seed: int = Field(42, description="Use the same seed as the run to see its exact intermittent bursts")
    points: int = Field(600, ge=10, le=2000)

    @model_validator(mode="after")
    def check_faults(self):
        for f in self.faults:
            if f.onset_s >= self.duration_s:
                raise ValueError(f"fault '{f.type}' starts after the run ends")
        return self


class SensorStats(BaseModel):
    mean: float
    std: float
    min: float
    max: float


class RunOut(BaseModel):
    id: str
    name: str
    kind: str
    created_at: str
    config: dict[str, Any]
    n_rows: int
    duration_s: float
    summary: dict[str, Any]


class RunWithPreview(RunOut):
    preview: dict[str, Any]


class ScenarioIn(BaseModel):
    name: str = Field(..., max_length=120)
    description: str = ""
    config: dict[str, Any]
