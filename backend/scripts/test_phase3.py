"""Phase 3 test: seed data, conditional VAE, conditional TimeGAN, synthetic runs and the generative API.

    python scripts/test_phase3.py        (from backend/; needs torch + fastapi + httpx; takes a few minutes on CPU)
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("BLISTERSYNTH_DATA_DIR", tempfile.mkdtemp(prefix="blistersynth_test3_"))

import numpy as np
import pandas as pd

from app.generative import (COND_COLS, LEARNED, build_conditions, build_seed_set, generate_run, quick_validation,
                            train_cvae, train_timegan)
from app.generative.base import N_C, N_FAULT_START, POCKET_IDX
from app.simulator import (FAULT_KEYS, LABEL_COLUMNS, SENSORS, STATIONS, FaultInjector, LineSimulator, SimConfig)

ok = True


def check(name: str, cond: bool, detail: str = "") -> None:
    global ok
    ok &= bool(cond)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))


def cond_row(f=1.0, sev: dict | None = None, n=4000) -> np.ndarray:
    c = np.zeros((n, N_C), dtype=np.float32)
    c[:, 0] = f
    for k, v in (sev or {}).items():
        c[:, N_FAULT_START + FAULT_KEYS.index(k)] = v
    return c


# ------------------------------------------------------------------------------------------
print("\n1) Seed set and conditions")
t0 = time.time()
seed = build_seed_set(n_runs=8, duration_s=900, seed=1)
check("shapes line up", seed.X.shape == (8 * 900, len(LEARNED)) and seed.C.shape == (8 * 900, N_C) and len(seed.bounds) == 8)
check("all values finite", np.isfinite(seed.X).all() and np.isfinite(seed.C).all())
check("speed condition in [0, 1]", seed.C[:, 0].min() >= 0 and seed.C[:, 0].max() <= 1.0001)
part = ((seed.C[:, 0] > 0.1) & (seed.C[:, 0] < 0.9)).mean()
check("seed set contains part-speed rows (ramps)", part > 0.05, f"{part:.1%} of rows")
check("faults appear in the seed set", seed.C[:, N_FAULT_START:].max() > 0.5)
check("every fault type has a non-zero severity somewhere (24 runs)",
      (build_seed_set(24, 600, 3).C[:, N_FAULT_START:] > 0.2).any(axis=0).all())
print(f"      ({time.time() - t0:.1f}s)")

# ------------------------------------------------------------------------------------------
print("\n2) Conditional VAE")
t0 = time.time()
seed_big = build_seed_set(n_runs=24, duration_s=1800, seed=11)
ticks = []
cvae, hist = train_cvae(seed_big, epochs=40, seed=0, progress=lambda e, n, i: ticks.append((e, n)))
print(f"      trained on {seed_big.n_rows} rows in {time.time() - t0:.0f}s")
check("progress reported every epoch", ticks[-1] == (40, 40) and len(ticks) == 40)
check("losses finite", all(np.isfinite(hist["train"])) and all(np.isfinite(hist["val"])))
val = quick_validation(cvae)
check("healthy means close to physics", val["max_abs_mean_err_sd"] < 1.5, f"max |mean err| = {val['max_abs_mean_err_sd']} sd")
check("healthy noise level reasonable", 0.6 < val["median_std_ratio"] < 1.5, f"median std ratio = {val['median_std_ratio']}")
bad = {k: v for k, v in val["sensors"].items() if abs(v["mean_err_sd"]) > 1.5 or not 0.3 < v["std_ratio"] < 2.5}
check("no sensor is badly off", not bad, str(bad) if bad else "")
print("      sealing_temp:", val["sensors"]["sealing_temp_c"], " vib_x:", val["sensors"]["vib_x_mm_s"])

print("\n3) Fault conditioning (cVAE): each fault moves its own sensor the right way")
EXPECT = {"bearing_wear": ("vib_x_mm_s", 3.2), "sealing_heater_degradation": ("sealing_temp_c", -14.0),
          "seal_pressure_leak": ("sealing_pressure_bar", -2.0), "vacuum_leak": ("vacuum_kpa", 26.0),
          "film_tension_instability": ("film_tension_n", 5.0), "cooling_blockage": ("cooling_flow_lpm", -9.0),
          "punch_dulling": ("cutting_force_n", 380.0), "pocket_feeder_jam": ("pocket_fill_count", -1.0)}
for fault, (sensor, delta) in EXPECT.items():
    j = LEARNED.index(sensor)
    h = cvae.sample(cond_row(), seed=1)[:, j].mean()
    f = cvae.sample(cond_row(sev={fault: 1.0}), seed=1)[:, j].mean()
    got = f - h
    check(f"{fault}: {sensor} {got:+.2f} (physics {delta:+g})", np.sign(got) == np.sign(delta) and abs(got) >= 0.5 * abs(delta))
j = LEARNED.index("vib_x_mm_s")
m = [cvae.sample(cond_row(sev={"bearing_wear": s}), seed=2)[:, j].mean() for s in (0, 0.5, 1.0)]
check("vibration rises with severity 0 < 0.5 < 1", m[0] < m[1] < m[2], f"{m[0]:.2f} / {m[1]:.2f} / {m[2]:.2f}")
sd0 = cvae.sample(cond_row(), seed=3)[:, LEARNED.index("sealing_temp_c")].std()
sd1 = cvae.sample(cond_row(sev={"sealing_heater_degradation": 1.0}), seed=3)[:, LEARNED.index("sealing_temp_c")].std()
check("heater fault adds noise (hunting)", sd1 > 1.3 * sd0, f"sd {sd0:.2f} -> {sd1:.2f}")
x = cvae.sample(cond_row(n=3000), seed=4)[:, LEARNED.index("motor_current_a")]
ac = np.corrcoef(x[:-1], x[1:])[0, 1]
check("generated noise is temporally correlated (AR latent)", ac > 0.3, f"lag-1 autocorr {ac:.2f}")

print("\n4) Speed handling")
for f in (0.3, 0.6):
    s = cvae.sample(cond_row(f=f), seed=5)
    cur, vib = s[:, LEARNED.index("motor_current_a")].mean(), s[:, LEARNED.index("vib_x_mm_s")].mean()
    check(f"speed {f:.0%}: motor current {cur:.2f} (physics {2.5 + 9.5 * f:.2f})", abs(cur - (2.5 + 9.5 * f)) < 1.2)
    check(f"speed {f:.0%}: vib_x {vib:.2f} (physics {0.15 + 1.65 * f**1.2:.2f})", abs(vib - (0.15 + 1.65 * f**1.2)) < 0.35)

print("\n5) Synthetic runs follow the physics scenario")
cfg = SimConfig(duration_s=3600, seed=21)
faults = [{"type": "bearing_wear", "onset_s": 600, "ramp_s": 2400, "intensity": 1.0},
          {"type": "punch_dulling", "onset_s": 1200, "ramp_s": 2000, "intensity": 1.2}]
inj = FaultInjector(faults, cfg.duration_s)
phys, phys_h = LineSimulator(cfg, [inj]).run()
syn, syn_h, used_seed, _ = generate_run(cvae, cfg, faults)
check("same columns as a physics run", list(syn.columns) == list(phys.columns))
check("same row count and timestamps", len(syn) == len(phys) and (syn["timestamp"] == phys["timestamp"]).all())
same_labels = all(((syn[c] == phys[c]) | (syn[c].isna() & phys[c].isna())).all() for c in LABEL_COLUMNS)
check("labels and RUL identical to the physics run", same_labels)
check("machine_state and line speed come from the physics profile",
      (syn["machine_state"] == phys["machine_state"]).all() and (syn["line_speed_bpm"] == phys["line_speed_bpm"]).all())
check("sensor values differ from physics (really generated)", not np.allclose(syn["vib_x_mm_s"], phys["vib_x_mm_s"]))
cur = syn["motor_current_a"].to_numpy()
check("ramp-up is visible in a synthetic run", cur[:30].mean() < 0.55 * cur[900:1500].mean(), f"{cur[:30].mean():.1f} A -> {cur[900:1500].mean():.1f} A")
check("sensor limits respected", all(syn[s.key].between(s.lo, s.hi).all() for s in SENSORS))
check("pocket count is 0 only when the machine is stopped", (syn.loc[syn["machine_state"] == "stopped", "pocket_fill_count"] == 0).all())
v = syn["vib_x_mm_s"].to_numpy()
check("bearing wear is visible: late vibration well above early", v[3200:3500].mean() > v[900:1200].mean() + 1.0, f"{v[900:1200].mean():.2f} -> {v[3200:3500].mean():.2f}")
check("health columns for all 7 stations in [0, 100]", list(syn_h.columns) == [s["key"] for s in STATIONS] and syn_h.min().min() >= 0 and syn_h.max().max() <= 100)
healthy_syn, healthy_h, _, _ = generate_run(cvae, SimConfig(duration_s=3600, seed=22), [])
check("healthy synthetic run stays mostly green", healthy_h.iloc[600:].mean().min() > 80, f"min station mean {healthy_h.iloc[600:].mean().min():.0f}")
check("faulty run: drive station health drops", syn_h["cartoning"].iloc[-600:].min() < 60, f"{syn_h['cartoning'].iloc[-600:].min():.0f}")
again, _, _, _ = generate_run(cvae, cfg, faults)
check("same request + seed -> identical data", again.equals(syn))
check("different seed -> different noise", not generate_run(cvae, SimConfig(duration_s=3600, seed=23), faults)[0]["vib_x_mm_s"].equals(syn["vib_x_mm_s"]))

# ------------------------------------------------------------------------------------------
print("\n6) Conditional TimeGAN")
t0 = time.time()
seed_small = build_seed_set(n_runs=12, duration_s=1200, seed=5)
tg, thist = train_timegan(seed_small, epochs=30, seed=0)
print(f"      trained on {seed_small.n_rows} rows in {time.time() - t0:.0f}s")
check("training losses finite", all(np.isfinite(thist["g_loss"])) and all(np.isfinite(thist["d_loss"])))
s = tg.sample(cond_row(n=1000), seed=1)
check("samples have the right shape and are finite", s.shape == (1000, len(LEARNED)) and np.isfinite(s).all())
check("sampling is deterministic per seed", np.allclose(s, tg.sample(cond_row(n=1000), seed=1)))
j = LEARNED.index("vib_x_mm_s")
h, f = tg.sample(cond_row(), seed=2)[:, j].mean(), tg.sample(cond_row(sev={"bearing_wear": 1.0}), seed=2)[:, j].mean()
check("responds to fault conditions (bearing wear raises vib_x)", f - h > 1.5, f"{h:.2f} -> {f:.2f}")
j = LEARNED.index("motor_current_a")
c3, c9 = tg.sample(cond_row(f=0.3), seed=3)[:, j].mean(), tg.sample(cond_row(f=0.9), seed=3)[:, j].mean()
check("responds to speed condition", c9 - c3 > 3.0, f"{c3:.1f} A at 30% -> {c9:.1f} A at 90%")
tv = quick_validation(tg)
check("healthy output in a sane range", tv["max_abs_mean_err_sd"] < 4, f"max |mean err| {tv['max_abs_mean_err_sd']} sd, median std ratio {tv['median_std_ratio']}")
tsyn, _, _, _ = generate_run(tg, SimConfig(duration_s=1800, seed=31), [])
check("TimeGAN synthetic run has the physics schema", list(tsyn.columns) == list(phys.columns) and len(tsyn) == 1800)

# ------------------------------------------------------------------------------------------
print("\n7) Generative API")
from fastapi.testclient import TestClient
from app.main import app


def wait_job(client, job_id, timeout=240):
    t_end = time.time() + timeout
    while time.time() < t_end:
        j = client.get(f"/api/generative/jobs/{job_id}").json()
        if j["status"] not in ("queued", "running"):
            return j
        time.sleep(0.5)
    return j


with TestClient(app) as client:
    check("API version is at least 0.3.0", tuple(map(int, client.get("/api/health").json()["version"].split("."))) >= (0, 3, 0))
    info = client.get("/api/generative/info").json()
    check("info lists learned sensors and conditions", info["learned_sensors"] == LEARNED and info["conditions"] == COND_COLS)
    check("no models yet", client.get("/api/generative/models").json() == [])

    r = client.post("/api/generative/train", json={"kind": "cvae", "name": "api cvae", "n_seed_runs": 4,
                                                   "seed_duration_s": 600, "epochs": 8})
    check("train returns 202 with a job", r.status_code == 202 and r.json()["status"] in ("queued", "running"))
    job = wait_job(client, r.json()["id"])
    check("job finishes with a model id", job["status"] == "done" and job["model_id"], str(job.get("error")))
    check("progress reached 100 %", job["progress"] == 1.0 and job["epoch"] == job["epochs"] == 8)
    model_id = job["model_id"]
    models = client.get("/api/generative/models").json()
    check("model listed with metadata and validation", len(models) == 1 and models[0]["kind"] == "cvae" and "validation" in models[0])
    check("GET model works", client.get(f"/api/generative/models/{model_id}").json()["id"] == model_id)
    check("job list contains the job", any(j["id"] == job["id"] for j in client.get("/api/generative/jobs").json()))

    body = {"name": "API synthetic", "model_id": model_id,
            "config": {"duration_s": 1800, "seed": 5},
            "faults": [{"type": "vacuum_leak", "onset_s": 600}]}
    g = client.post("/api/generative/generate", json=body)
    check("generate returns 200", g.status_code == 200, g.text[:200] if g.status_code != 200 else "")
    gj = g.json()
    check("run is stored as kind=generative", gj["kind"] == "generative" and gj["n_rows"] == 1800)
    check("config records the model and faults", gj["config"]["model_id"] == model_id and gj["config"]["faults"][0]["type"] == "vacuum_leak")
    check("preview rows carry labels", gj["preview"]["rows"][-1]["sev_vacuum_leak"] > 0.9 and gj["preview"]["rows"][-1]["fault_type"] == "vacuum_leak")
    check("summary has stations and labels", set(gj["summary"]["stations"]) == {s["key"] for s in STATIONS} and gj["summary"]["labels"]["active_fraction"] > 0)
    check("run is listed and downloadable", any(r["id"] == gj["id"] for r in client.get("/api/runs").json())
          and client.get(f"/api/runs/{gj['id']}/download").status_code == 200)
    phys_resp = client.post("/api/simulate", json={"name": "same request", "config": body["config"], "faults": body["faults"]}).json()
    check("same request gives the same labels as /api/simulate",
          phys_resp["summary"]["labels"] == gj["summary"]["labels"])

    r2 = client.post("/api/simulate", json={"name": "seed run", "config": {"duration_s": 3600, "seed": 9},
                                            "faults": [{"type": "bearing_wear", "onset_s": 300}]}).json()
    t = client.post("/api/generative/train", json={"kind": "cvae", "name": "from saved run", "run_ids": [r2["id"]], "epochs": 6})
    jj = wait_job(client, t.json()["id"])
    check("training from a saved physics run works", jj["status"] == "done", str(jj.get("error")))
    check("saved generative run cannot be used as seed", client.post("/api/generative/train", json={"run_ids": [gj["id"]]}).status_code == 422)

    t = client.post("/api/generative/train", json={"kind": "timegan", "name": "api timegan", "n_seed_runs": 4,
                                                   "seed_duration_s": 600, "epochs": 6})
    jt = wait_job(client, t.json()["id"])
    check("TimeGAN job works and generates", jt["status"] == "done" and
          client.post("/api/generative/generate", json={**body, "model_id": jt["model_id"]}).status_code == 200, str(jt.get("error")))

    t = client.post("/api/generative/train", json={"kind": "timegan", "name": "to cancel", "n_seed_runs": 8,
                                                   "seed_duration_s": 900, "epochs": 600})
    time.sleep(3)
    c = client.post(f"/api/generative/jobs/{t.json()['id']}/cancel")
    check("cancel accepted", c.status_code == 200)
    jc = wait_job(client, t.json()["id"], timeout=60)
    check("job ends as cancelled and saves no model", jc["status"] == "cancelled" and jc["model_id"] is None)
    check("cancelling a finished job is harmless", client.post(f"/api/generative/jobs/{job['id']}/cancel").json()["status"] == "done")

    check("unknown model -> 404", client.post("/api/generative/generate", json={**body, "model_id": "mdl_nope"}).status_code == 404)
    check("unknown job -> 404", client.get("/api/generative/jobs/job_nope").status_code == 404
          and client.post("/api/generative/jobs/job_nope/cancel").status_code == 404)
    check("unknown run_ids -> 404", client.post("/api/generative/train", json={"run_ids": ["run_nope"]}).status_code == 404)
    check("bad kind -> 422", client.post("/api/generative/train", json={"kind": "gan"}).status_code == 422)
    check("bad fault in generate -> 422", client.post("/api/generative/generate", json={**body, "faults": [{"type": "nope"}]}).status_code == 422)
    check("delete model works once", client.delete(f"/api/generative/models/{model_id}").status_code == 200
          and client.delete(f"/api/generative/models/{model_id}").status_code == 404)
    check("generate after delete -> 404", client.post("/api/generative/generate", json=body).status_code == 404)

print("\n" + ("ALL CHECKS PASSED" if ok else "SOME CHECKS FAILED"))
sys.exit(0 if ok else 1)
