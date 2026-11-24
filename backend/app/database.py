"""Tiny SQLite layer (standard-library sqlite3, no ORM) for runs, scenarios and datasets."""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from .config import DB_PATH, ensure_dirs

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL,          -- physics | generative | upload
    created_at   TEXT NOT NULL,
    config_json  TEXT NOT NULL,
    n_rows       INTEGER NOT NULL,
    duration_s   REAL NOT NULL,
    file_path    TEXT NOT NULL,
    summary_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scenarios (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL,
    config_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS datasets (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    source       TEXT NOT NULL,          -- upload | generated
    created_at   TEXT NOT NULL,
    n_rows       INTEGER NOT NULL,
    file_path    TEXT NOT NULL,
    columns_json TEXT NOT NULL
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    ensure_dirs()
    with connect() as conn:
        conn.executescript(SCHEMA)


def _row_to_run(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["config"] = json.loads(d.pop("config_json"))
    d["summary"] = json.loads(d.pop("summary_json"))
    return d


# ---------------------------------------------------------------- runs
def insert_run(run: dict[str, Any]) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO runs (id, name, kind, created_at, config_json, n_rows, duration_s, file_path, summary_json)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (run["id"], run["name"], run["kind"], run["created_at"], json.dumps(run["config"]),
             run["n_rows"], run["duration_s"], run["file_path"], json.dumps(run["summary"])),
        )


def list_runs(limit: int = 100) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return [_row_to_run(r) for r in rows]


def get_run(run_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    return _row_to_run(row) if row else None


def count_runs_by_kind() -> dict[str, int]:
    """{'physics': 3, 'generative': 1, ...} - used by the dashboard overview."""
    with connect() as conn:
        rows = conn.execute("SELECT kind, COUNT(*) AS n FROM runs GROUP BY kind").fetchall()
    return {r["kind"]: int(r["n"]) for r in rows}


def delete_run(run_id: str) -> bool:
    with connect() as conn:
        cur = conn.execute("DELETE FROM runs WHERE id = ?", (run_id,))
    return cur.rowcount > 0


# ---------------------------------------------------------------- scenarios
def save_scenario(name: str, config: dict[str, Any], description: str = "") -> dict[str, Any]:
    sc = {"id": new_id("scn"), "name": name, "description": description,
          "created_at": now_iso(), "config": config}
    with connect() as conn:
        conn.execute(
            "INSERT INTO scenarios (id, name, description, created_at, config_json) VALUES (?, ?, ?, ?, ?)",
            (sc["id"], name, description, sc["created_at"], json.dumps(config)),
        )
    return sc


def list_scenarios() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM scenarios ORDER BY created_at DESC").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["config"] = json.loads(d.pop("config_json"))
        out.append(d)
    return out


def delete_scenario(scenario_id: str) -> bool:
    with connect() as conn:
        cur = conn.execute("DELETE FROM scenarios WHERE id = ?", (scenario_id,))
    return cur.rowcount > 0


def count_scenarios() -> int:
    with connect() as conn:
        return int(conn.execute("SELECT COUNT(*) FROM scenarios").fetchone()[0])


# ---------------------------------------------------------------- renames (Phase 7)
def rename_run(run_id: str, name: str) -> bool:
    with connect() as conn:
        cur = conn.execute("UPDATE runs SET name = ? WHERE id = ?", (name, run_id))
    return cur.rowcount > 0


def rename_scenario(scenario_id: str, name: str, description: str | None = None) -> bool:
    with connect() as conn:
        if description is None:
            cur = conn.execute("UPDATE scenarios SET name = ? WHERE id = ?", (name, scenario_id))
        else:
            cur = conn.execute("UPDATE scenarios SET name = ?, description = ? WHERE id = ?", (name, description, scenario_id))
    return cur.rowcount > 0


# ---------------------------------------------------------------- datasets (Phase 7 Data Lab)
# The `datasets` table has existed since Phase 1. Its `columns_json` text column now holds a small JSON object:
# {"columns": [...], "mapping": {...}, "sample_rate_hz": 1.0, "has_labels": false, "duration_s": 3600.0}
def _row_to_dataset(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    meta = json.loads(d.pop("columns_json"))
    if isinstance(meta, list):              # tolerate the plain list format
        meta = {"columns": meta}
    return d | meta


def insert_dataset(ds: dict[str, Any]) -> None:
    meta = {k: ds[k] for k in ("columns", "mapping", "sample_rate_hz", "has_labels", "duration_s") if k in ds}
    with connect() as conn:
        conn.execute(
            "INSERT INTO datasets (id, name, source, created_at, n_rows, file_path, columns_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (ds["id"], ds["name"], ds.get("source", "upload"), ds["created_at"], ds["n_rows"], ds["file_path"], json.dumps(meta)),
        )


def list_datasets() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM datasets ORDER BY created_at DESC").fetchall()
    return [_row_to_dataset(r) for r in rows]


def get_dataset(dataset_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM datasets WHERE id = ?", (dataset_id,)).fetchone()
    return _row_to_dataset(row) if row else None


def rename_dataset(dataset_id: str, name: str) -> bool:
    with connect() as conn:
        cur = conn.execute("UPDATE datasets SET name = ? WHERE id = ?", (name, dataset_id))
    return cur.rowcount > 0


def delete_dataset(dataset_id: str) -> bool:
    with connect() as conn:
        cur = conn.execute("DELETE FROM datasets WHERE id = ?", (dataset_id,))
    return cur.rowcount > 0


def count_datasets() -> int:
    with connect() as conn:
        return int(conn.execute("SELECT COUNT(*) FROM datasets").fetchone()[0])
