"""REST endpoints: sensor catalogue, batch simulation, saved runs and scenarios."""
from __future__ import annotations

import math
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from .. import database as db
from ..config import PREVIEW_POINTS, RUNS_DIR
from ..datalab import MEDIA, export_bytes
from ..schemas import RunOut, RunWithPreview, ScenarioIn, SimulateRequest
from ..simulator import (SENSORS, STATIONS, LineSimulator, SimConfig, build_injector, health_status,
                         label_summary)

router = APIRouter(prefix="/api", tags=["simulator"])


def _summary(data: pd.DataFrame, health: pd.DataFrame) -> dict:
    sensors = {}
    for s in SENSORS:
        col = data[s.key]
        sensors[s.key] = {"mean": round(float(col.mean()), 4), "std": round(float(col.std()), 4),
                          "min": round(float(col.min()), 4), "max": round(float(col.max()), 4)}
    stations = {}
    for st in STATIONS:
        h = health[st["key"]]
        stations[st["key"]] = {"mean_health": round(float(h.mean()), 2),
                               "min_health": round(float(h.min()), 2),
                               "status": health_status(float(h.min()))}
    return {
        "sensors": sensors,
        "stations": stations,
        "machine_state_counts": {k: int(v) for k, v in data["machine_state"].value_counts().items()},
        "shift_counts": {k: int(v) for k, v in data["shift"].value_counts().items()},
        "labels": label_summary(data),
    }


def records(df: pd.DataFrame) -> list[dict]:
    """DataFrame -> list of dicts that is valid JSON (NaN, e.g. an undefined RUL, becomes null)."""
    return df.astype(object).where(df.notna(), None).to_dict(orient="records")


def _preview(data: pd.DataFrame, health: pd.DataFrame | None, max_points: int) -> dict:
    """Down-sample to <= max_points rows so charts stay fast in the browser."""
    stride = max(1, math.ceil(len(data) / max_points))
    d = data.iloc[::stride]
    out = {"stride": stride, "rows": records(d)}
    if health is not None:
        out["health"] = records(health.iloc[::stride])
    return out


def _run_file(run_id: str) -> Path:
    return RUNS_DIR / f"{run_id}.csv"


@router.get("/sensors")
def get_sensors():
    """Sensor catalogue + station layout (the frontend builds its charts from this)."""
    return {"sensors": [s.to_dict() for s in SENSORS], "stations": STATIONS}


@router.post("/simulate", response_model=RunWithPreview)
def simulate(req: SimulateRequest):
    # Plain `def` (not async): FastAPI runs it in a worker thread so the server stays responsive.
    cfg = SimConfig.from_dict(req.config.model_dump())
    injector = build_injector([f.model_dump() for f in req.faults], cfg.duration_s) if req.faults else None
    sim = LineSimulator(cfg, modifiers=[injector] if injector else None)
    data, health = sim.run()

    run_id = db.new_id("run")
    path = _run_file(run_id)
    full = pd.concat([data, health.add_prefix("health_")], axis=1)
    full.to_csv(path, index=False)

    config = cfg.to_dict() | {"seed": sim.seed, "faults": injector.to_dicts() if injector else []}
    run = {"id": run_id, "name": req.name, "kind": "physics", "created_at": db.now_iso(),
           "config": config, "n_rows": len(data), "duration_s": float(cfg.duration_s),
           "file_path": str(path), "summary": _summary(data, health)}
    db.insert_run(run)
    run.pop("file_path")
    return run | {"preview": _preview(data, health, PREVIEW_POINTS)}


@router.get("/runs", response_model=list[RunOut])
def list_runs(limit: int = Query(100, ge=1, le=1000)):
    return db.list_runs(limit)


@router.get("/runs/{run_id}", response_model=RunOut)
def get_run(run_id: str):
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@router.get("/runs/{run_id}/data")
def get_run_data(run_id: str, max_points: int = Query(PREVIEW_POINTS, ge=10, le=20000)):
    run = db.get_run(run_id)
    if not run or not Path(run["file_path"]).exists():
        raise HTTPException(404, "Run not found")
    full = pd.read_csv(run["file_path"])
    health_cols = [c for c in full.columns if c.startswith("health_")]
    health = full[health_cols].rename(columns=lambda c: c.removeprefix("health_"))
    data = full.drop(columns=health_cols)
    return _preview(data, health, max_points)


@router.get("/runs/{run_id}/download")
def download_run(run_id: str, format: str = Query("csv", pattern="^(csv|parquet|json)$")):
    """CSV (default, unchanged), Parquet (pyarrow) or JSON (list of records)."""
    run = db.get_run(run_id)
    if not run or not Path(run["file_path"]).exists():
        raise HTTPException(404, "Run not found")
    if format == "csv":
        return FileResponse(run["file_path"], media_type="text/csv", filename=f"{run_id}.csv")
    body = export_bytes(pd.read_csv(run["file_path"]), format)
    return Response(body, media_type=MEDIA[format], headers={"Content-Disposition": f'attachment; filename="{run_id}.{format}"'})


class RenameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str | None = Field(None, max_length=500, description="scenarios only")


@router.patch("/runs/{run_id}")
def rename_run(run_id: str, req: RenameRequest):
    if not db.rename_run(run_id, req.name.strip()):
        raise HTTPException(404, "Run not found")
    return {"id": run_id, "name": req.name.strip()}


@router.get("/runs/{run_id}/report")
def run_report(run_id: str):
    """One-click PDF report (reportlab + matplotlib): config, sensor charts with fault periods, labels/RUL, quality, PdM."""
    from ..pdf_report import build_run_report          # imported here so matplotlib/reportlab load only when needed
    run = db.get_run(run_id)
    if not run or not Path(run["file_path"]).exists():
        raise HTTPException(404, "Run not found")
    try:
        pdf = build_run_report(run, pd.read_csv(run["file_path"]))
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{run_id}_report.pdf"'})


@router.delete("/runs/{run_id}")
def delete_run(run_id: str):
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    Path(run["file_path"]).unlink(missing_ok=True)
    db.delete_run(run_id)
    return {"deleted": run_id}


@router.get("/scenarios")
def list_scenarios():
    return db.list_scenarios()


@router.post("/scenarios")
def save_scenario(sc: ScenarioIn):
    return db.save_scenario(sc.name, sc.config, sc.description)


@router.patch("/scenarios/{scenario_id}")
def rename_scenario(scenario_id: str, req: RenameRequest):
    if not db.rename_scenario(scenario_id, req.name.strip(), req.description):
        raise HTTPException(404, "Scenario not found")
    return {"id": scenario_id, "name": req.name.strip()}


@router.delete("/scenarios/{scenario_id}")
def delete_scenario(scenario_id: str):
    if not db.delete_scenario(scenario_id):
        raise HTTPException(404, "Scenario not found")
    return {"deleted": scenario_id}
