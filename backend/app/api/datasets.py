"""Data Lab endpoints (Phase 7): upload / validate / map a CSV, save it as a dataset, list, rename, delete, export."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import database as db
from ..config import PREVIEW_POINTS, UPLOADS_DIR, ensure_dirs
from ..datalab import (EXPORT_FORMATS, MEDIA, SCHEMA_TARGETS, SENSOR_KEYS, DataLabError, check_mapping, column_stats,
                       export_bytes, normalise, parse_csv, preview_rows, suggest_mapping)
from .simulate import _preview

router = APIRouter(prefix="/api/datasets", tags=["data-lab"])


class RenameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


async def _read(file: UploadFile) -> pd.DataFrame:
    raw = await file.read()
    try:
        return parse_csv(raw)
    except DataLabError as exc:
        raise HTTPException(422, str(exc))


def _parse_mapping(text: str | None, df: pd.DataFrame) -> dict[str, str]:
    """The form field `mapping` is JSON {schema name: column}. Empty -> use the automatic suggestion."""
    if not text:
        return {v["target"]: c for c, v in suggest_mapping(list(df.columns)).items()}
    try:
        m = json.loads(text)
        if not isinstance(m, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in m.items()):
            raise ValueError
        return m
    except ValueError:
        raise HTTPException(422, "mapping must be a JSON object {schema field: column name}")


@router.get("/schema")
def schema():
    """The columns a dataset must provide (14 sensors) and the optional ones."""
    return {"required": SENSOR_KEYS, "optional": [c for c in SCHEMA_TARGETS if c not in SENSOR_KEYS],
            "formats": list(EXPORT_FORMATS)}


@router.post("/inspect")
async def inspect(file: UploadFile = File(...)):
    """Step 1 + 2 of the upload: read the file, suggest a column mapping, show a preview. Nothing is saved."""
    df = await _read(file)
    cols = list(df.columns)
    sug = suggest_mapping(cols)
    mapping = {v["target"]: c for c, v in sug.items()}
    return {"filename": file.filename, "n_rows": len(df), "columns": cols, "suggested_mapping": mapping,
            "match_kinds": {v["target"]: v["match"] for v in sug.values()}, "check": check_mapping(cols, mapping),
            "preview": preview_rows(df), "stats": column_stats(df)}


@router.post("", status_code=201)
async def create(file: UploadFile = File(...), name: str = Form(""), mapping: str = Form(""),
                 sample_rate_hz: float = Form(1.0)):
    """Step 3: save. Applies the (possibly edited) mapping, cleans the data and stores it as a dataset."""
    df = await _read(file)
    m = _parse_mapping(mapping, df)
    try:
        clean, info = normalise(df, m, sample_rate_hz)
    except DataLabError as exc:
        raise HTTPException(422, str(exc))
    ensure_dirs()
    ds_id = db.new_id("ds")
    path = UPLOADS_DIR / f"{ds_id}.csv"
    clean.to_csv(path, index=False)
    ds = {"id": ds_id, "name": (name.strip() or Path(file.filename or "dataset").stem)[:120], "source": "upload",
          "created_at": db.now_iso(), "n_rows": len(clean), "file_path": str(path), "columns": list(clean.columns),
          "mapping": m, "sample_rate_hz": info["sample_rate_hz"], "has_labels": info["has_labels"], "duration_s": info["duration_s"]}
    db.insert_dataset(ds)
    ds.pop("file_path")
    return ds | {"notes": info["notes"], "out_of_range": info["out_of_range"]}


@router.get("")
def list_datasets():
    return [{k: v for k, v in d.items() if k != "file_path"} for d in db.list_datasets()]


def _get(dataset_id: str) -> dict:
    ds = db.get_dataset(dataset_id)
    if not ds or not Path(ds["file_path"]).exists():
        raise HTTPException(404, "Dataset not found")
    return ds


@router.get("/{dataset_id}")
def get_dataset(dataset_id: str):
    ds = _get(dataset_id)
    df = pd.read_csv(ds["file_path"])
    return {k: v for k, v in ds.items() if k != "file_path"} | {"preview": preview_rows(df), "stats": column_stats(df[SENSOR_KEYS])}


@router.get("/{dataset_id}/data")
def get_data(dataset_id: str, max_points: int = Query(PREVIEW_POINTS, ge=10, le=20000)):
    """Down-sampled rows for charts (same shape as /api/runs/{id}/data)."""
    return _preview(pd.read_csv(_get(dataset_id)["file_path"]), None, max_points)


@router.patch("/{dataset_id}")
def rename(dataset_id: str, req: RenameRequest):
    _get(dataset_id)
    db.rename_dataset(dataset_id, req.name.strip())
    return {"id": dataset_id, "name": req.name.strip()}


@router.delete("/{dataset_id}")
def delete(dataset_id: str):
    ds = db.get_dataset(dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    Path(ds["file_path"]).unlink(missing_ok=True)
    db.delete_dataset(dataset_id)
    return {"deleted": dataset_id}


@router.get("/{dataset_id}/download")
def download(dataset_id: str, format: str = Query("csv", pattern="^(csv|parquet|json)$")):
    ds = _get(dataset_id)
    body = export_bytes(pd.read_csv(ds["file_path"]), format)
    return Response(body, media_type=MEDIA[format], headers={"Content-Disposition": f'attachment; filename="{dataset_id}.{format}"'})
