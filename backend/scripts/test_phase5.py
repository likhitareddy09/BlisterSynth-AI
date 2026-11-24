"""Phase 5 test: the /api/overview endpoint, the contract the React frontend relies on, CORS and /app hosting.

    python scripts/test_phase5.py        (from backend/; needs torch + scikit-learn; about 1-2 minutes on CPU)

The frontend's own tests live in frontend/ (npm test).  This script checks the backend side of the same
contract: every endpoint and field the UI reads has to exist with the shape frontend/src/api/types.ts expects.
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("BLISTERSYNTH_DATA_DIR", tempfile.mkdtemp(prefix="blistersynth_test5_"))

from fastapi.testclient import TestClient

from app.config import FRONTEND_DIST
from app.main import app

ok = True


def check(name: str, cond: bool, detail: str = "") -> None:
    global ok
    ok &= bool(cond)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))


def has(d: dict, *keys: str) -> bool:
    return all(k in d for k in keys)


with TestClient(app) as client:
    print("overview")
    ov = client.get("/api/overview").json()
    check("overview shape", has(ov, "app", "version", "runs", "scenarios", "generative_models", "pdm_models", "active_jobs")
          and has(ov["runs"], "total", "by_kind"))
    check("empty store counts are zero", ov["runs"]["total"] == 0 and ov["scenarios"] == 0 and ov["active_jobs"] == 0)
    check("version is 0.7.0 and matches /api/health", ov["version"] == "0.7.0" == client.get("/api/health").json()["version"])

    print("frontend contract: catalogues")
    cat = client.get("/api/sensors").json()
    check("sensors expose key/label/unit/decimals", all(has(s, "key", "label", "unit", "decimals") for s in cat["sensors"]))
    check("stations expose key/label/sensors", all(has(s, "key", "label", "sensors") for s in cat["stations"]))
    fc = client.get("/api/faults/catalog").json()
    check("fault types have key/label, profiles have key",
          len(fc["fault_types"]) == 8 and all(has(f, "key", "label") for f in fc["fault_types"])
          and all(has(p, "key") for p in fc["profiles"]))

    print("frontend contract: simulate / runs")
    fault = {"type": fc["fault_types"][0]["key"], "profile": None, "onset_s": 200, "intensity": 1.5}
    body = {"name": "UI run", "config": {"duration_s": 600, "sample_rate_hz": 1, "seed": 5, "nominal_speed_bpm": 220,
            "noise_scale": 1, "drift_scale": 1, "include_startup": True, "include_shutdown": True}, "faults": [fault]}
    sim = client.post("/api/simulate", json=body).json()
    rows, health = sim["preview"]["rows"], sim["preview"]["health"]
    sensor_keys = [s["key"] for s in cat["sensors"]]
    check("preview rows have t_s, fault_active and every sensor", all(k in rows[0] for k in ["t_s", "fault_active", *sensor_keys]))
    check("preview health is numeric per station", health and all(isinstance(v, (int, float)) for v in health[0].values()))
    check("fault shows up as fault_active in the preview", any(r["fault_active"] for r in rows))
    ov = client.get("/api/overview").json()
    check("overview counts the new run", ov["runs"]["total"] == 1 and ov["runs"]["by_kind"] == {"physics": 1})
    runs = client.get("/api/runs").json()
    check("runs list has id/name/kind/created_at/n_rows", all(has(r, "id", "name", "kind", "created_at", "n_rows") for r in runs))
    data = client.get(f"/api/runs/{sim['id']}/data?max_points=100").json()
    check("run data endpoint matches the preview shape", has(data, "stride", "rows", "health") and len(data["rows"]) <= 100)
    labels = client.get(f"/api/runs/{sim['id']}/labels").json()
    check("labels give segments with start_s/end_s", labels["segments"] and has(labels["segments"][0], "start_s", "end_s"))
    check("download link works", client.get(f"/api/runs/{sim['id']}/download").status_code == 200)

    print("frontend contract: validation errors are readable")
    bad = client.post("/api/simulate", json={"config": {"duration_s": 5}})
    detail = bad.json()["detail"]
    check("invalid config -> 422 with loc/msg list", bad.status_code == 422 and isinstance(detail, list) and has(detail[0], "loc", "msg"))
    check("fault after the end of the run -> 422",
          client.post("/api/simulate", json={"config": {"duration_s": 120}, "faults": [{"type": fault["type"], "onset_s": 500}]}).status_code == 422)
    check("unknown run -> 404 with a string detail", client.get("/api/runs/run_nope/data").json()["detail"] == "Run not found")

    print("frontend contract: scenarios (Simulator save/load)")
    saved = client.post("/api/scenarios", json={"name": "UI scenario", "description": "", "config": {"config": body["config"], "faults": [fault]}}).json()
    listed = client.get("/api/scenarios").json()
    check("scenario round-trips the {config, faults} shape the UI saves",
          listed and listed[0]["config"]["faults"][0]["type"] == fault["type"] and listed[0]["config"]["config"]["duration_s"] == 600)
    check("overview counts scenarios", client.get("/api/overview").json()["scenarios"] == 1)
    check("delete scenario", client.delete(f"/api/scenarios/{saved['id']}").status_code == 200
          and client.get("/api/overview").json()["scenarios"] == 0)

    print("frontend contract: WebSocket (Live monitor)")
    with client.websocket_connect("/ws/stream") as ws:
        hello = ws.receive_json()
        check("hello has sensors, stations and fault catalogue", hello["type"] == "hello" and has(hello, "sensors", "stations", "faults")
              and "fault_types" in hello["faults"])
        tick = ws.receive_json()
        while tick["type"] != "tick":
            tick = ws.receive_json()
        row = tick["rows"][0]
        check("tick rows carry t_s, health, status, fault_active", has(row, "t_s", "health", "status", "fault_active"))
        ws.send_json({"action": "inject", "fault": {"type": fault["type"], "onset_s": 0, "intensity": 1}})
        ack = ws.receive_json()
        while ack["type"] not in ("ack", "error"):
            ack = ws.receive_json()
        check("inject ack names the fault (shown in the UI notice)", ack["type"] == "ack" and ack["fault"]["type"] == fault["type"])
        ws.send_json({"action": "inject", "fault": {"type": "no_such_fault"}})
        err = ws.receive_json()
        while err["type"] not in ("ack", "error"):
            err = ws.receive_json()
        check("bad inject -> error message, socket stays usable", err["type"] == "error" and bool(err["message"]))
        ws.send_json({"action": "pause"})
        ack = ws.receive_json()
        while ack["type"] != "ack":
            ack = ws.receive_json()
        check("pause ack carries paused/speed", ack["paused"] is True and "speed" in ack)

    print("frontend contract: generative jobs + PdM (small, fast settings)")
    job = client.post("/api/generative/train", json={"kind": "cvae", "name": "UI cvae", "n_seed_runs": 4, "seed_duration_s": 600,
                                                      "epochs": 3, "seed": 7}).json()
    check("train returns a job with the fields the UI reads",
          has(job, "id", "name", "status", "stage", "progress", "epoch", "epochs", "error") and job["status"] in ("queued", "running"))
    check("overview reports the active job", client.get("/api/overview").json()["active_jobs"] >= 1)
    t0 = time.time()
    while job["status"] in ("queued", "running") and time.time() - t0 < 150:
        time.sleep(1.0)
        job = client.get(f"/api/generative/jobs/{job['id']}").json()
    check("job finishes with a model id", job["status"] == "done" and job["model_id"], job["status"] + " " + str(job.get("error")))
    models = client.get("/api/generative/models").json()
    check("model list has id/name/kind/created_at", models and has(models[0], "id", "name", "kind", "created_at"))
    check("overview counts the generative model", client.get("/api/overview").json()["generative_models"] == 1)
    gen = client.post("/api/generative/generate", json={"name": "UI gen", "model_id": job["model_id"],
                                                         "config": {"duration_s": 600}, "faults": [fault]})
    check("generate with the UI's body shape", gen.status_code == 200 and gen.json()["kind"] == "generative"
          and has(gen.json()["preview"], "rows", "health"))
    check("cancel unknown job -> 404", client.post("/api/generative/jobs/job_nope/cancel").status_code == 404)

    pdm = client.post("/api/pdm/train", json={"task": "fault", "name": "UI pdm", "train_source": "physics", "n_train_runs": 8,
                                              "n_test_runs": 3, "duration_s": 600, "seed": 7})
    check("PdM train -> id/name/task/train_source/metrics", pdm.status_code == 200 and has(pdm.json(), "id", "name", "task", "train_source", "metrics"),
          str(pdm.status_code))
    pm = pdm.json()
    check("PdM metrics contain numbers for the model table", any(isinstance(v, (int, float)) for v in pm["metrics"].values()))
    pred = client.post("/api/pdm/predict", json={"model_id": pm["id"], "run_id": sim["id"]}).json()
    check("predict gives t_s + p_fault of equal length", len(pred["t_s"]) == len(pred["p_fault"]) > 0 and pred["task"] == "fault")
    q = client.post("/api/quality/compare", json={"real_run_id": sim["id"], "synthetic_run_id": gen.json()["id"]})
    check("quality compare gives score + components", q.status_code == 200 and has(q.json(), "score", "components"))
    check("overview counts the PdM model", client.get("/api/overview").json()["pdm_models"] == 1)
    check("delete PdM + generative model", client.delete(f"/api/pdm/models/{pm['id']}").status_code == 200
          and client.delete(f"/api/generative/models/{job['model_id']}").status_code == 200)

    print("CORS and hosting")
    pre = client.options("/api/overview", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    check("Vite dev origin (5173) is allowed by CORS", pre.headers.get("access-control-allow-origin") == "http://localhost:5173")
    if FRONTEND_DIST.is_dir():
        page = client.get("/app/")
        check("built frontend is served at /app/", page.status_code == 200 and "BlisterSynth" in page.text)
        check("/ and /docs still work next to /app", client.get("/").json()["docs"] == "/docs" and client.get("/docs").status_code == 200)
    else:
        print("  [SKIP] frontend/dist not built - run `npm run build` in frontend/ to test /app hosting")

    check("delete the test run", client.delete(f"/api/runs/{sim['id']}").status_code == 200)

print("\n" + ("ALL CHECKS PASSED" if ok else "SOME CHECKS FAILED"))
sys.exit(0 if ok else 1)
