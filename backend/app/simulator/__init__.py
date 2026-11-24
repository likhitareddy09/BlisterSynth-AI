"""Physics-informed blister-line simulator (the digital twin)."""
from .engine import LineSimulator, SimConfig, ChunkContext, health_status
from .faults import FAULT_TYPES, PROFILES, FaultInjector, FaultSpec, build_injector, catalog
from .labels import ACTIVE_THRESHOLD, FAULT_KEYS, LABEL_COLUMNS, SEV_COLUMNS, capped_rul, fault_segments, label_summary
from .sensors import SENSORS, STATIONS, SENSOR_BY_KEY, POCKETS_PER_BLISTER

__all__ = [
    "LineSimulator",
    "SimConfig",
    "ChunkContext",
    "health_status",
    "FAULT_TYPES",
    "PROFILES",
    "FaultInjector",
    "FaultSpec",
    "build_injector",
    "catalog",
    "ACTIVE_THRESHOLD",
    "FAULT_KEYS",
    "LABEL_COLUMNS",
    "SEV_COLUMNS",
    "capped_rul",
    "fault_segments",
    "label_summary",
    "SENSORS",
    "STATIONS",
    "SENSOR_BY_KEY",
    "POCKETS_PER_BLISTER",
]
