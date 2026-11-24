"""Sensor catalogue and machine-station layout of the blister line.

Each SensorSpec says what the sensor measures, its normal value, how noisy it is,
how "sticky" its noise is (AR(1) phi), its physical limits and which station it
belongs to. The frontend reads this catalogue through GET /api/sensors.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

POCKETS_PER_BLISTER = 10  # a 10-tablet blister card


@dataclass(frozen=True)
class SensorSpec:
    key: str
    label: str
    unit: str
    nominal: float      # value at full speed in a healthy steady state
    noise_sd: float     # standard deviation of measurement/process noise
    phi: float          # AR(1) coefficient at 1 Hz (0 = white noise, ->1 = slow wander)
    lo: float           # physical lower limit (values are clipped)
    hi: float           # physical upper limit
    station: str
    decimals: int
    description: str

    def to_dict(self) -> dict:
        return asdict(self)


SENSORS: list[SensorSpec] = [
    SensorSpec("forming_temp_c", "Forming temperature", "°C", 135.0, 0.6, 0.95, 15, 220,
               "forming", 2, "PVC/PVDC film heater plate before thermoforming the pockets."),
    SensorSpec("sealing_temp_c", "Sealing temperature", "°C", 180.0, 0.8, 0.95, 15, 260,
               "sealing", 2, "Heated sealing roller that bonds lidding foil to the formed film."),
    SensorSpec("sealing_pressure_bar", "Sealing pressure", "bar", 4.5, 0.05, 0.80, 0, 8,
               "sealing", 3, "Pneumatic pressure pressing the foil onto the film."),
    SensorSpec("film_tension_n", "Film tension", "N", 120.0, 1.8, 0.85, 0, 300,
               "unwind", 2, "Web tension measured by the dancer/load cell after the unwind reel."),
    SensorSpec("vacuum_kpa", "Forming vacuum", "kPa", -80.0, 0.5, 0.80, -101, 0,
               "forming", 2, "Gauge vacuum pulling softened film into the pocket mould."),
    SensorSpec("motor_current_a", "Main drive current", "A", 12.0, 0.2, 0.70, 0, 40,
               "cartoning", 3, "Current drawn by the main servo/gearbox drive."),
    SensorSpec("vib_x_mm_s", "Vibration X", "mm/s", 1.80, 0.06, 0.50, 0, 30,
               "cartoning", 3, "RMS vibration velocity of the main drive bearing (axial)."),
    SensorSpec("vib_y_mm_s", "Vibration Y", "mm/s", 1.50, 0.06, 0.50, 0, 30,
               "cartoning", 3, "RMS vibration velocity of the main drive bearing (radial)."),
    SensorSpec("vib_z_mm_s", "Vibration Z", "mm/s", 1.20, 0.05, 0.50, 0, 30,
               "punching", 3, "RMS vibration velocity at the punching press (vertical)."),
    SensorSpec("line_speed_bpm", "Line speed", "blisters/min", 220.0, 0.8, 0.90, 0, 400,
               "filling", 1, "Machine output speed from the main encoder."),
    SensorSpec("cooling_flow_lpm", "Cooling water flow", "L/min", 18.0, 0.25, 0.90, 0, 40,
               "cooling", 2, "Chilled-water flow through the cooling plates after sealing."),
    SensorSpec("humidity_pct", "Room humidity", "%RH", 45.0, 0.4, 0.98, 0, 100,
               "environment", 1, "Cleanroom relative humidity (affects film and foil behaviour)."),
    SensorSpec("cutting_force_n", "Cutting force", "N", 850.0, 10.0, 0.60, 0, 3000,
               "punching", 1, "Peak force of the punching/cutting stroke."),
    SensorSpec("pocket_fill_count", "Pocket fill (vision)", "pockets", float(POCKETS_PER_BLISTER),
               0.0, 0.0, 0, POCKETS_PER_BLISTER, "filling", 0,
               "Camera count of correctly filled pockets on the last inspected blister."),
]

SENSOR_BY_KEY: dict[str, SensorSpec] = {s.key: s for s in SENSORS}

# Every sensor except the discrete vision count gets Gaussian AR(1) noise.
CONTINUOUS_KEYS: list[str] = [s.key for s in SENSORS if s.key != "pocket_fill_count"]

# Stations in material-flow order, with the sensors that decide their health colour.
# The main drive motor and its bearing are modelled at the cartoner end of the line.
STATIONS: list[dict] = [
    {"key": "unwind", "label": "Unwind", "sensors": ["film_tension_n"]},
    {"key": "forming", "label": "Forming", "sensors": ["forming_temp_c", "vacuum_kpa"]},
    {"key": "filling", "label": "Filling", "sensors": ["pocket_fill_count", "line_speed_bpm"]},
    {"key": "sealing", "label": "Sealing", "sensors": ["sealing_temp_c", "sealing_pressure_bar"]},
    {"key": "cooling", "label": "Cooling", "sensors": ["cooling_flow_lpm"]},
    {"key": "punching", "label": "Punching / Cutting", "sensors": ["cutting_force_n", "vib_z_mm_s"]},
    {"key": "cartoning", "label": "Cartoning + Main drive",
     "sensors": ["motor_current_a", "vib_x_mm_s", "vib_y_mm_s"]},
]
