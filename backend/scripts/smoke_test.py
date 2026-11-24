"""Phase 1 smoke test.  Run from the backend/ folder:

    python scripts/smoke_test.py

Checks the simulator physics, reproducibility, batch-vs-stream equality and
(if FastAPI + httpx are installed) the REST API and WebSocket end to end.
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
# Use a throw-away data folder so the test never touches your real runs.
os.environ.setdefault("BLISTERSYNTH_DATA_DIR", tempfile.mkdtemp(prefix="blistersynth_test_"))

import numpy as np
import pandas as pd

from app.simulator import SENSORS, LineSimulator, SimConfig

ok = True


def check(name: str, cond: bool, detail: str = "") -> None:
    global ok
    ok &= bool(cond)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))


print("\n1) Two-hour physics run")
t0 = time.perf_counter()
cfg = SimConfig(duration_s=7200, seed=7)
data, health = LineSimulator(cfg).run()
print(f"  generated {len(data):,} rows x {data.shape[1]} columns in {time.perf_counter() - t0:.2f}s")
steady = data[data.machine_state == "running"]
pd.set_option("display.width", 120)
print(steady[[s.key for s in SENSORS]].describe().T[["mean", "std", "min", "max"]].round(3).to_string())

check("row count", len(data) == 7200)
check("starts stopped, ramps up", data.line_speed_bpm.iloc[0] < 5 and data.line_speed_bpm.iloc[400] > 200)
check("ends ramped down", data.line_speed_bpm.iloc[-1] < 5)
check("steady speed near 220 bpm", abs(steady.line_speed_bpm.mean() - 220) < 2,
      f"{steady.line_speed_bpm.mean():.1f}")
check("sealing temp warms up from cold start",
      data.sealing_temp_c.iloc[0] < 170 and abs(steady.sealing_temp_c.mean() - 177.5) < 2,
      f"start {data.sealing_temp_c.iloc[0]:.1f} -> steady {steady.sealing_temp_c.mean():.1f}")
r_speed_current = data.line_speed_bpm.corr(data.motor_current_a)
check("motor current follows speed (physics)", r_speed_current > 0.95, f"r={r_speed_current:.3f}")
r_vib = steady.vib_x_mm_s.corr(steady.vib_y_mm_s)
check("vibration X/Y noise correlated", 0.3 < r_vib < 0.9, f"r={r_vib:.2f}")
ac = steady.sealing_temp_c.autocorr(1)
check("sealing temp noise is autocorrelated (AR(1))", ac > 0.8, f"lag-1 autocorr={ac:.2f}")
check("pocket count mostly 10", (steady.pocket_fill_count == 10).mean() > 0.9,
      f"{(steady.pocket_fill_count == 10).mean():.1%} perfect blisters")
check("healthy line is green", (health.min(axis=1) >= 80).mean() > 0.97,
      f"{(health.min(axis=1) >= 80).mean():.1%} of rows all-green")

print("\n2) Reproducibility + streaming continuity")
a, _ = LineSimulator(SimConfig(duration_s=600, seed=1)).run()
b, _ = LineSimulator(SimConfig(duration_s=600, seed=1)).run()
c, _ = LineSimulator(SimConfig(duration_s=600, seed=2)).run()
check("same seed -> identical data", a.equals(b))
check("different seed -> different data", not a.equals(c))
sim = LineSimulator(SimConfig(duration_s=600, seed=1))
parts = [sim.generate(37)[0] for _ in range(20)]
streamed = pd.concat(parts, ignore_index=True)
num = [s.key for s in SENSORS]
check("chunked stream == batch", np.allclose(streamed[num].values, a[num].values))

print("\n3) Shift handover across 14:00")
d, _ = LineSimulator(SimConfig(duration_s=3600, start_time="2026-01-05T13:40:00",
                               include_startup=False, include_shutdown=False)).run()
check("shift changes A -> B", list(d["shift"].unique()) == ["A", "B"])
check("speed dips at handover", d.loc[d.machine_state == "shift_change", "line_speed_bpm"].min() < 160)

print("\n4) API (FastAPI TestClient)")
try:
    from fastapi.testclient import TestClient
    from app.main import app
except ImportError as e:
    print(f"  [SKIP] {e}. Run `pip install -r requirements.txt` to test the API.")
else:
    with TestClient(app) as client:
        check("GET /api/health", client.get("/api/health").json()["status"] == "ok")
        check("GET /api/sensors", len(client.get("/api/sensors").json()["sensors"]) == 14)
        r = client.post("/api/simulate", json={"name": "smoke", "config": {"duration_s": 1800, "seed": 3}})
        check("POST /api/simulate", r.status_code == 200, f"status {r.status_code}")
        run = r.json()
        check("preview down-sampled", len(run["preview"]["rows"]) <= 600)
        check("GET /api/runs lists it", any(x["id"] == run["id"] for x in client.get("/api/runs").json()))
        check("download CSV", client.get(f"/api/runs/{run['id']}/download").status_code == 200)
        bad = client.post("/api/simulate", json={"config": {"duration_s": 10}})
        check("rejects invalid config", bad.status_code == 422)
        with client.websocket_connect("/ws/stream") as ws:
            hello = ws.receive_json()
            ws.send_json({"action": "speed", "value": 50})
            msgs = [ws.receive_json() for _ in range(4)]
            ticks = [m for m in msgs if m["type"] == "tick"]
            check("WebSocket hello + ticks", hello["type"] == "hello" and len(ticks) >= 1)
            check("tick rows carry station health", "health" in ticks[0]["rows"][0])
        check("DELETE run", client.delete(f"/api/runs/{run['id']}").status_code == 200)

print("\nALL CHECKS PASSED" if ok else "\nSOME CHECKS FAILED")
sys.exit(0 if ok else 1)
