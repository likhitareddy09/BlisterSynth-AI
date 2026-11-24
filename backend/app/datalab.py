"""Data Lab core (Phase 7): read an uploaded CSV, match its columns to the sensor schema, clean it, export it.

Pipeline for an upload
----------------------
1. parse_csv(raw_bytes)                     -> DataFrame (+ size / row limits)
2. suggest_mapping(columns)                 -> best guess  {schema name: your column}  (exact, alias, fuzzy match)
3. check_mapping(columns, mapping)          -> which sensors are still missing?  (all 14 are required)
4. normalise(df, mapping, sample_rate_hz)   -> the standard run layout: t_s, 14 sensors, machine_state and the label
                                               columns (fault_active, fault_type, rul_s ... default to "healthy")
After step 4 a dataset looks exactly like a saved run, so quality reports, PdM models and generative training can
use it without special cases.
"""
from __future__ import annotations

import difflib
import io
import re
from typing import Any

import numpy as np
import pandas as pd

from .config import MAX_ROWS, MAX_UPLOAD_MB
from .simulator import FAULT_KEYS, SENSORS, SEV_COLUMNS

SENSOR_KEYS: list[str] = [s.key for s in SENSORS]
OPTIONAL_COLUMNS = ["t_s", "timestamp", "machine_state", "fault_active", "fault_type", "rul_s"]
SCHEMA_TARGETS = SENSOR_KEYS + OPTIONAL_COLUMNS
MAX_NAN_FRACTION = 0.2        # a sensor with more than 20 % missing values is rejected
DEFAULT_START = "2026-01-05T06:00:00"


class DataLabError(ValueError):
    """A problem with the uploaded file that the user can fix (the API turns it into HTTP 422)."""


# ------------------------------------------------------------------ names
def _norm(name: str) -> str:
    """'Forming Temp (°C)' -> 'forming_temp'.  Lower-case, units in brackets removed, non-alphanumerics -> '_'."""
    s = re.sub(r"[\(\[\{][^\)\]\}]*[\)\]\}]", " ", str(name).lower())
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


_UNIT_SUFFIX = re.compile(r"_(c|bar|n|kpa|a|mm_s|bpm|lpm|pct|count)$")


def _alias_table() -> dict[str, str]:
    """normalised alias -> schema name. Built from each sensor's key, label and the key without its unit suffix."""
    table: dict[str, str] = {}
    for s in SENSORS:
        for alias in (s.key, s.label, _UNIT_SUFFIX.sub("", s.key), s.key.replace("_", "")):
            table.setdefault(_norm(alias), s.key)
    extra = {"time": "t_s", "time_s": "t_s", "seconds": "t_s", "t": "t_s", "elapsed_s": "t_s", "datetime": "timestamp",
             "date_time": "timestamp", "time_stamp": "timestamp", "state": "machine_state", "machine_status": "machine_state",
             "fault": "fault_type", "fault_label": "fault_type", "label": "fault_type", "failure_type": "fault_type",
             "is_fault": "fault_active", "anomaly": "fault_active", "rul": "rul_s", "remaining_useful_life": "rul_s",
             "temperature_forming": "forming_temp_c", "temp_forming": "forming_temp_c", "temp_sealing": "sealing_temp_c",
             "speed": "line_speed_bpm", "line_speed": "line_speed_bpm", "motor_current": "motor_current_a",
             "humidity": "humidity_pct", "vibration_x": "vib_x_mm_s", "vibration_y": "vib_y_mm_s", "vibration_z": "vib_z_mm_s",
             "vib_x": "vib_x_mm_s", "vib_y": "vib_y_mm_s", "vib_z": "vib_z_mm_s", "vacuum": "vacuum_kpa",
             "cutting_force": "cutting_force_n", "film_tension": "film_tension_n", "cooling_flow": "cooling_flow_lpm",
             "seal_pressure": "sealing_pressure_bar", "pocket_fill": "pocket_fill_count"}
    for k, v in extra.items():
        table.setdefault(k, v)
    return table


def suggest_mapping(columns: list[str]) -> dict[str, dict[str, str]]:
    """Best guess for every uploaded column: {column: {"target": schema name, "match": exact|alias|fuzzy}}.

    A schema name is used at most once (the best match wins). Columns with no good match are left out.
    """
    table = _alias_table()
    keys = list(table)
    rank = {"exact": 0, "alias": 1, "fuzzy": 2}
    found: dict[str, tuple[int, float, str, str]] = {}          # target -> (rank, -score, column, match)
    for col in columns:
        n = _norm(col)
        if n in SCHEMA_TARGETS:
            target, match, score = n, "exact", 1.0
        elif n in table:
            target, match, score = table[n], "alias", 0.95
        else:
            close = difflib.get_close_matches(n, keys, n=1, cutoff=0.8)
            if not close:
                continue
            target, match = table[close[0]], "fuzzy"
            score = difflib.SequenceMatcher(None, n, close[0]).ratio()
        cand = (rank[match], -score, col, match)
        if target not in found or cand < found[target]:
            found[target] = cand
    return {c: {"target": t, "match": m} for t, (_, _, c, m) in found.items()}


def check_mapping(columns: list[str], mapping: dict[str, str]) -> dict[str, Any]:
    """`mapping` is {schema name: uploaded column}. Returns what is missing / invalid (never raises)."""
    unknown_targets = [t for t in mapping if t not in SCHEMA_TARGETS]
    unknown_cols = [c for c in mapping.values() if c not in columns]
    dup = [c for c in set(mapping.values()) if list(mapping.values()).count(c) > 1]
    missing = [k for k in SENSOR_KEYS if k not in mapping]
    errors = []
    if unknown_targets:
        errors.append(f"Unknown schema fields: {', '.join(unknown_targets)}")
    if unknown_cols:
        errors.append(f"Columns not in the file: {', '.join(unknown_cols)}")
    if dup:
        errors.append(f"One column is mapped to several fields: {', '.join(dup)}")
    return {"missing": missing, "errors": errors, "ready": not missing and not errors,
            "unmapped_columns": [c for c in columns if c not in mapping.values()]}


# ------------------------------------------------------------------ reading
def parse_csv(raw: bytes) -> pd.DataFrame:
    if not raw:
        raise DataLabError("The file is empty.")
    if len(raw) > MAX_UPLOAD_MB * 1024 * 1024:
        raise DataLabError(f"The file is larger than {MAX_UPLOAD_MB} MB.")
    df = None
    for enc in ("utf-8-sig", "latin-1"):
        try:
            first = raw[:4096].decode(enc, errors="ignore").splitlines()[0] if raw[:4096].strip() else ""
            sep = max((",", ";", "\t", "|"), key=first.count)          # comma / semicolon / tab / pipe, fast C parser
            df = pd.read_csv(io.BytesIO(raw), encoding=enc, sep=sep)
            break
        except UnicodeDecodeError:
            continue
        except (pd.errors.ParserError, pd.errors.EmptyDataError) as exc:
            raise DataLabError(f"Could not read the file as CSV: {exc}")
    if df is None:
        raise DataLabError("Could not decode the file (use UTF-8 CSV).")
    df.columns = [str(c).strip() for c in df.columns]
    if df.shape[1] < 2:
        raise DataLabError("The file has fewer than 2 columns - is it a CSV with a header row?")
    if len(df) < 130:
        raise DataLabError("Need at least 130 rows (about 2 minutes at 1 Hz) to build 60-second feature windows.")
    if len(df) > MAX_ROWS:
        raise DataLabError(f"The file has {len(df):,} rows; the limit is {MAX_ROWS:,}.")
    return df


def _clean(v: Any) -> Any:
    if isinstance(v, (np.floating, float)):
        return None if not np.isfinite(v) else round(float(v), 4)
    if isinstance(v, np.integer):
        return int(v)
    return v


def column_stats(df: pd.DataFrame) -> dict[str, dict[str, Any]]:
    """mean/std/min/max/missing for every numeric column (used for the preview)."""
    out = {}
    for c in df.columns:
        num = pd.to_numeric(df[c], errors="coerce")
        if num.notna().sum() >= 0.5 * len(df):
            out[c] = {"mean": _clean(num.mean()), "std": _clean(num.std()), "min": _clean(num.min()),
                      "max": _clean(num.max()), "missing": int(num.isna().sum())}
    return out


def preview_rows(df: pd.DataFrame, n: int = 10) -> list[dict[str, Any]]:
    head = df.head(n).astype(object).where(df.head(n).notna(), None)
    return [{k: _clean(v) for k, v in r.items()} for r in head.to_dict(orient="records")]


# ------------------------------------------------------------------ cleaning
def normalise(df: pd.DataFrame, mapping: dict[str, str], sample_rate_hz: float = 1.0) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Standard run layout from an uploaded frame. Returns (clean frame, info). Raises DataLabError with a clear message."""
    chk = check_mapping(list(df.columns), mapping)
    if chk["errors"]:
        raise DataLabError("; ".join(chk["errors"]))
    if chk["missing"]:
        raise DataLabError(f"Map all 14 sensors before saving. Missing: {', '.join(chk['missing'])}")
    if not (0 < sample_rate_hz <= 10):
        raise DataLabError("sample_rate_hz must be between 0 and 10.")

    out = pd.DataFrame(index=range(len(df)))
    notes: list[str] = []
    for spec in SENSORS:
        col = pd.to_numeric(df[mapping[spec.key]], errors="coerce").astype(float)
        frac = float(col.isna().mean())
        if frac > MAX_NAN_FRACTION:
            raise DataLabError(f"'{mapping[spec.key]}' ({spec.key}) is {frac:.0%} non-numeric or empty; the limit is {MAX_NAN_FRACTION:.0%}.")
        if frac > 0:
            col = col.interpolate(limit_direction="both")
            notes.append(f"{spec.key}: {frac:.1%} missing values were filled by interpolation")
        if not np.isfinite(col).all():
            raise DataLabError(f"'{mapping[spec.key]}' contains infinite values.")
        out[spec.key] = col.round(6)

    if "t_s" in mapping:
        t = pd.to_numeric(df[mapping["t_s"]], errors="coerce").astype(float)
        if t.isna().any() or not (np.diff(t.to_numpy()) > 0).all():
            raise DataLabError(f"'{mapping['t_s']}' must be numbers that strictly increase (seconds).")
        t = t - t.iloc[0]
        sample_rate_hz = float(1.0 / np.median(np.diff(t.to_numpy())))
    else:
        t = pd.Series(np.arange(len(df)) / sample_rate_hz)
    front = pd.DataFrame({"t_s": t.round(3).to_numpy()})
    if "timestamp" in mapping:
        ts = pd.to_datetime(df[mapping["timestamp"]], errors="coerce")
        front["timestamp"] = (ts.dt.strftime("%Y-%m-%dT%H:%M:%S.%f").str[:-3]).fillna("").to_numpy() if ts.notna().all() else \
            (pd.Timestamp(DEFAULT_START) + pd.to_timedelta(front["t_s"], unit="s")).dt.strftime("%Y-%m-%dT%H:%M:%S.%f").str[:-3]
    else:
        front["timestamp"] = (pd.Timestamp(DEFAULT_START) + pd.to_timedelta(front["t_s"], unit="s")).dt.strftime("%Y-%m-%dT%H:%M:%S.%f").str[:-3]
    front["shift"] = "A"
    front["machine_state"] = df[mapping["machine_state"]].astype(str).str.strip().str.lower().to_numpy() if "machine_state" in mapping else "running"
    res = pd.concat([front, out], axis=1)

    # label columns: take them if mapped, otherwise the dataset is treated as healthy
    has_labels = False
    ftype = pd.Series("none", index=res.index)
    if "fault_type" in mapping:
        ftype = df[mapping["fault_type"]].astype(str).str.strip().str.lower().replace({"nan": "none", "": "none", "normal": "none", "healthy": "none", "ok": "none"})
        bad = sorted(set(ftype) - set(FAULT_KEYS) - {"none"})
        if bad:
            raise DataLabError(f"Unknown fault types in '{mapping['fault_type']}': {', '.join(bad[:5])}. Allowed: none, {', '.join(FAULT_KEYS)}")
        has_labels = bool((ftype != "none").any())
    if "fault_active" in mapping:
        fa = pd.to_numeric(df[mapping["fault_active"]], errors="coerce").fillna(0).clip(0, 1).round().astype(int)
        has_labels = has_labels or bool(fa.any())
    else:
        fa = (ftype != "none").astype(int)
    res["fault_active"] = fa.to_numpy()
    ftype = ftype.where(~((fa == 1) & (ftype == "none")), "unspecified")     # binary labels without a fault name
    res["fault_type"] = np.where(res["fault_active"] == 1, ftype, "none")
    res["fault_station"] = "none"
    res["fault_profile"] = np.where(res["fault_active"] == 1, "gradual", "none")
    res["fault_severity"] = res["fault_active"].astype(float)
    res["fault_count"] = res["fault_active"]
    res["rul_s"] = pd.to_numeric(df[mapping["rul_s"]], errors="coerce").to_numpy() if "rul_s" in mapping else np.nan
    for col in SEV_COLUMNS:
        key = col.removeprefix("sev_")
        res[col] = np.where((res["fault_type"] == key), 1.0, 0.0)
    if not has_labels:
        notes.append("No fault labels found - the dataset is treated as healthy data.")

    info = {"sample_rate_hz": round(sample_rate_hz, 4), "duration_s": float(res["t_s"].iloc[-1]), "has_labels": has_labels, "notes": notes,
            "out_of_range": {s.key: round(float(((res[s.key] < s.lo) | (res[s.key] > s.hi)).mean()), 4) for s in SENSORS
                             if ((res[s.key] < s.lo) | (res[s.key] > s.hi)).mean() > 0.01}}
    return res, info


# ------------------------------------------------------------------ export
EXPORT_FORMATS = ("csv", "parquet", "json")
MEDIA = {"csv": "text/csv", "parquet": "application/vnd.apache.parquet", "json": "application/json"}


def export_bytes(df: pd.DataFrame, fmt: str) -> bytes:
    """DataFrame -> CSV / Parquet (pyarrow) / JSON (records, NaN -> null) bytes."""
    if fmt == "csv":
        return df.to_csv(index=False).encode()
    if fmt == "json":
        return df.to_json(orient="records").encode()
    if fmt == "parquet":
        buf = io.BytesIO()
        df.to_parquet(buf, engine="pyarrow", index=False)
        return buf.getvalue()
    raise DataLabError(f"Unknown format '{fmt}'. Use one of: {', '.join(EXPORT_FORMATS)}")
