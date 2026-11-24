"""Phase 2 test: fault injection, ground-truth labels and RUL.  Run from backend/:

    python scripts/test_phase2.py

Needs only numpy/pandas/scipy for sections 1-9; sections 10-11 also need
FastAPI + httpx (installed by requirements.txt) and are skipped otherwise.
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("BLISTERSYNTH_DATA_DIR", tempfile.mkdtemp(prefix="blistersynth_test_"))

import numpy as np
import pandas as pd

from app.simulator import (FAULT_KEYS, FAULT_TYPES, LABEL_COLUMNS, PROFILES, SENSORS, SEV_COLUMNS, STATIONS,
                           FaultInjector, LineSimulator, SimConfig, capped_rul, catalog, fault_segments)

ok = True


def check(name: str, cond: bool, detail: str = "") -> None:
    global ok
    ok &= bool(cond)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))


def run(dur: int, faults: list[dict] | None = None, seed: int = 5, **cfg):
    inj = FaultInjector(faults, dur) if faults else None
    sim = LineSimulator(SimConfig(duration_s=dur, seed=seed, **cfg), [inj] if inj else None)
    d, h = sim.run()
    return d, h, inj


SENSOR_KEYS = [s.key for s in SENSORS]
STATION_KEYS = [s["key"] for s in STATIONS]

# ------------------------------------------------------------------------------------------
print("\n1) Fault catalogue")
cat = catalog()
check("8 fault types", len(FAULT_TYPES) == 8 and len(cat["fault_types"]) == 8)
check("3 profiles", set(PROFILES) == {"gradual", "sudden", "intermittent"})
check("every fault sits in a real station", all(f.station in STATION_KEYS for f in FAULT_TYPES.values()))
check("every fault only disturbs real sensors",
      all(set(f.sensors) <= set(SENSOR_KEYS) for f in FAULT_TYPES.values()))
check("all 3 profiles used as defaults", {f.default_profile for f in FAULT_TYPES.values()} == set(PROFILES))
check("every fault has a signature text", all(len(f.signature()) > 0 for f in FAULT_TYPES.values()))
check("faults cover all 7 stations", {f.station for f in FAULT_TYPES.values()} == set(STATION_KEYS))

# ------------------------------------------------------------------------------------------
print("\n2) Healthy runs carry neutral labels")
DUR = 7200
base, base_h, _ = run(DUR)
check("label columns present", all(c in base.columns for c in LABEL_COLUMNS))
check("fault_active all 0, type 'none'", base.fault_active.sum() == 0 and (base.fault_type == "none").all())
check("RUL undefined (NaN) without faults", base.rul_s.isna().all())
check("8 per-fault severity columns, all 0", len(SEV_COLUMNS) == 8 and (base[SEV_COLUMNS] == 0).all().all()
      and SEV_COLUMNS == [f"sev_{k}" for k in FAULT_TYPES])
same = LineSimulator(SimConfig(duration_s=600, seed=5)).run()[0]
with_empty = LineSimulator(SimConfig(duration_s=600, seed=5), [FaultInjector([], 600)]).run()[0]
check("empty injector changes nothing", same.equals(with_empty))

# ------------------------------------------------------------------------------------------
print("\n3) Each fault: right sensors, right direction, right labels (gradual, onset 1800, failure 5400)")
ONSET, RAMP = 1800, 3600
late = slice(5700, 7000)                      # severity = 1 here
expect = {  # fault -> (sensor, statistic, minimum change)
    "bearing_wear": ("vib_x_mm_s", "mean", +1.5),
    "sealing_heater_degradation": ("sealing_temp_c", "mean", -8.0),
    "seal_pressure_leak": ("sealing_pressure_bar", "mean", -1.2),
    "vacuum_leak": ("vacuum_kpa", "mean", +15.0),
    "film_tension_instability": ("film_tension_n", "std", +3.0),
    "cooling_blockage": ("cooling_flow_lpm", "mean", -5.0),
    "punch_dulling": ("cutting_force_n", "mean", +200.0),
    "pocket_feeder_jam": ("pocket_fill_count", "mean", -0.4),
}
for key, ft in FAULT_TYPES.items():
    d, h, inj = run(DUR, [{"type": key, "profile": "gradual", "onset_s": ONSET, "ramp_s": RAMP}])
    sensor, stat, need = expect[key]
    delta = getattr(d[sensor].iloc[late], stat)() - getattr(base[sensor].iloc[late], stat)()
    good = delta >= need if need > 0 else delta <= need
    check(f"{key}: {sensor} {stat} {delta:+.2f} (need {need:+g})", good)

    act = d[d.fault_active == 1]
    check(f"{key}: labels correct", len(act) > 0 and (act.fault_type == key).all()
          and (act.fault_station == ft.station).all() and (act.fault_profile == "gradual").all())
    others = [c for c in SEV_COLUMNS if c != f"sev_{key}"]
    check(f"{key}: only its own sev_ column lights up",
          (d[others] == 0).all().all() and np.allclose(d.loc[d.fault_active == 1, f"sev_{key}"],
                                                      d.loc[d.fault_active == 1, "fault_severity"]))
    check(f"{key}: no label before onset", (d.iloc[:ONSET].fault_active == 0).all()
          and act.t_s.min() >= ONSET)
    check(f"{key}: station '{ft.station}' goes red", h[ft.station].iloc[late].min() < 50,
          f"min health {h[ft.station].iloc[late].min():.0f}")
    ctl = "forming" if ft.station == "unwind" else "unwind"
    check(f"{key}: control station '{ctl}' stays green", (h[ctl].iloc[late] >= 80).mean() > 0.95)
    untouched = [k for k in SENSOR_KEYS if k not in ft.sensors and k != "pocket_fill_count"]
    check(f"{key}: all other sensors bit-identical to healthy run",
          all(np.array_equal(d[k].values, base[k].values) for k in untouched))

# ------------------------------------------------------------------------------------------
print("\n4) Profile shapes")
t = np.arange(0, 14400, dtype=float)
g = FaultInjector([{"type": "bearing_wear", "profile": "gradual", "onset_s": 3600, "ramp_s": 7200}], 14400)
g.bind(1)
sg = g.severity_matrix(t)[0]
check("gradual: 0 before onset, monotone, 1 at failure",
      sg[:3600].max() == 0 and np.all(np.diff(sg) >= -1e-12) and sg[10800:].min() == 1.0)
check("gradual: bearing curve accelerates (power 2)", abs(sg[7200] - 0.25) < 0.01, f"s(mid)={sg[7200]:.3f}")
s = FaultInjector([{"type": "vacuum_leak", "onset_s": 3600}], 14400)
s.bind(1)
ss = s.severity_matrix(t)[0]
check("sudden: step to 1 within 10 s", ss[3599] == 0 and ss[3610] == 1.0)
i = FaultInjector([{"type": "pocket_feeder_jam", "onset_s": 3600, "ramp_s": 7200}], 14400)
i.bind(1)
si = i.severity_matrix(t)[0]
act = si > 0.05
rises = int((act[1:] & ~act[:-1]).sum())
third = 7200 // 3
early, late_f = act[3600:3600 + third].mean(), act[3600 + 2 * third:10800].mean()
check("intermittent: several separate bursts", rises >= 4, f"{rises} bursts")
check("intermittent: off between bursts, on during", 0.05 < act[3600:10800].mean() < 0.95,
      f"duty {act[3600:10800].mean():.0%}")
check("intermittent: bursts get more frequent as it matures", late_f > early + 0.15,
      f"first third {early:.0%} -> last third {late_f:.0%}")
check("intermittent: permanent after failure time", si[10850:].min() == 1.0)
i2 = FaultInjector([{"type": "pocket_feeder_jam", "onset_s": 3600, "ramp_s": 7200}], 14400)
i2.bind(1)
check("intermittent: same seed -> same schedule", np.array_equal(i2.severity_matrix(t)[0], si))
i3 = FaultInjector([{"type": "pocket_feeder_jam", "onset_s": 3600, "ramp_s": 7200}], 14400)
i3.bind(2)
check("intermittent: different seed -> different schedule", not np.array_equal(i3.severity_matrix(t)[0], si))
# schedule must not depend on how time is chunked
i4 = FaultInjector([{"type": "pocket_feeder_jam", "onset_s": 3600, "ramp_s": 7200}], 14400)
i4.bind(1)
chunked = np.concatenate([i4.severity_matrix(t[k:k + 250])[0] for k in range(0, 14400, 250)])
check("intermittent: chunking-independent", np.array_equal(chunked, si))

# regression: onset lies beyond the first 3600-sample chunk (no bursts exist yet in chunk 0)
d, _, _ = run(8000, [{"type": "film_tension_instability", "onset_s": 5000, "ramp_s": 2000}])
check("onset beyond first chunk works", (d.fault_active == 1).any() and d.iloc[:5000].fault_active.sum() == 0)

# ------------------------------------------------------------------------------------------
print("\n5) Remaining Useful Life")
d, _, _ = run(DUR, [{"type": "bearing_wear", "onset_s": ONSET, "ramp_s": RAMP}])
check("RUL counts down to failure time", d.rul_s.iloc[0] == 5400 and d.rul_s.iloc[5400] == 0)
check("RUL never negative, never increases", d.rul_s.min() == 0 and (d.rul_s.diff().dropna() <= 1e-9).all())
check("RUL stays 0 after failure", (d.rul_s.iloc[5400:] == 0).all())
d, _, _ = run(DUR, [{"type": "vacuum_leak", "onset_s": 2000}])
check("sudden fault: RUL = time to onset", d.rul_s.iloc[0] == 2000 and (d.rul_s.iloc[2000:] == 0).all())
d, _, _ = run(DUR, [{"type": "bearing_wear", "onset_s": 1000, "ramp_s": 5000, "end_s": 3000}])
check("repaired before failure: no failure pending", d.rul_s.isna().all())
check("repair clears labels and effect", (d.iloc[3000:].fault_active == 0).all()
      and abs(d.vib_x_mm_s.iloc[4000:6000].mean() - base.vib_x_mm_s.iloc[4000:6000].mean()) < 0.1)
d, _, _ = run(DUR, [{"type": "bearing_wear", "onset_s": 500, "ramp_s": 1500, "end_s": 4000}])
check("failed then repaired: RUL 0 until repair, NaN after",
      (d.rul_s.iloc[2000:4000] == 0).all() and d.rul_s.iloc[4000:].isna().all())
d, _, _ = run(DUR, [{"type": "bearing_wear", "onset_s": 0, "ramp_s": 6000},
                    {"type": "punch_dulling", "onset_s": 0, "ramp_s": 3000, "intensity": 0.3}])
check("two faults: RUL is the nearest failure", d.rul_s.iloc[0] == 3000 and d.rul_s.iloc[3000] == 0)
check("two faults: fault_count = 2 and strongest effect is dominant",
      d.fault_count.max() == 2 and (d.loc[d.fault_count == 2, "fault_type"] == "bearing_wear").mean() > 0.5)
both = d[(d.sev_bearing_wear > 0.05) & (d.sev_punch_dulling > 0.05)]
hidden = both[both.fault_type == "bearing_wear"]
check("two faults: weaker fault stays visible in its own sev_ column even when not dominant",
      len(both) > 100 and len(hidden) > 0 and (hidden.sev_punch_dulling > 0.05).all())
cap = capped_rul(np.array([9000.0, 300.0, np.nan]), 1000)
check("capped_rul helper", cap[0] == 1000 and cap[1] == 300 and np.isnan(cap[2]))

# ------------------------------------------------------------------------------------------
print("\n6) Labels -> episodes")
d, _, _ = run(DUR, [{"type": "pocket_feeder_jam", "onset_s": 1000, "ramp_s": 4000}])
raw = fault_segments(d)
merged = fault_segments(d, merge_gap_s=600)
check("intermittent gives several segments", len(raw) >= 3, f"{len(raw)} raw, {len(merged)} merged")
check("merging joins bursts", len(merged) < len(raw))
check("segments carry type/station/profile",
      all(s["fault_type"] == "pocket_feeder_jam" and s["station"] == "filling"
          and s["profile"] == "intermittent" for s in raw))
d2, _, _ = run(DUR, [{"type": "bearing_wear", "onset_s": 0, "ramp_s": 3000},
                     {"type": "punch_dulling", "onset_s": 500, "ramp_s": 2000, "intensity": 0.2}])
seg2 = fault_segments(d2)
check("simultaneous faults -> overlapping segments, none hidden",
      {x["fault_type"] for x in seg2} == {"bearing_wear", "punch_dulling"}
      and len(seg2) == 2 and seg2[0]["end_s"] > seg2[1]["start_s"])

# ------------------------------------------------------------------------------------------
print("\n7) Reproducibility and streaming continuity WITH faults")
F = [{"type": "bearing_wear", "onset_s": 100, "ramp_s": 400},
     {"type": "film_tension_instability", "onset_s": 50, "ramp_s": 500},
     {"type": "vacuum_leak", "onset_s": 300},
     {"type": "pocket_feeder_jam", "onset_s": 200, "ramp_s": 350}]
a, ah, _ = run(600, F, seed=11)
b, bh, _ = run(600, F, seed=11)
c, _, _ = run(600, F, seed=12)
check("same seed + faults -> identical rows (incl. labels)", a.equals(b) and ah.equals(bh))
check("different seed -> different rows", not a.equals(c))
inj = FaultInjector(F, 600)
sim = LineSimulator(SimConfig(duration_s=600, seed=11), [inj])
parts = []
while not sim.done:
    parts.append(sim.generate(37)[0])
streamed = pd.concat(parts, ignore_index=True)
check("chunked stream == batch with 4 faults active (all columns)", streamed.equals(a))
check("sim.time_s tracks progress", abs(sim.time_s - 600) < 1e-9)

# ------------------------------------------------------------------------------------------
print("\n8) Live injection and repair (what the WebSocket does)")
inj = FaultInjector([], None)
sim = LineSimulator(SimConfig(seed=3, include_shutdown=False), [inj], streaming=True)
pre, _ = sim.generate(120)
now = sim.time_s
info = inj.add({"type": "punch_dulling", "profile": "sudden"}, onset_s=now + 10)
mid, _ = sim.generate(60)
rep = inj.repair(sim.time_s)
post, _ = sim.generate(60)
check("add() returns the resolved fault", info["profile"] == "sudden" and info["onset_s"] == now + 10
      and info["station"] == "punching" and info["failure_s"] == now + 10)
check("healthy before injection", pre.fault_active.sum() == 0)
check("fault starts at injected onset", mid.fault_active.iloc[:10].sum() == 0 and mid.fault_active.iloc[20:].all())
check("repair clears it", rep == 1 and post.fault_active.sum() == 0 and post.rul_s.isna().all())

# ------------------------------------------------------------------------------------------
print("\n9) Speed")
t0 = time.perf_counter()
d, _, _ = run(86400, [{"type": k, "onset_s": 3600 * (i + 1)} for i, k in enumerate(FAULT_TYPES)])
elapsed = time.perf_counter() - t0
check("24 h at 1 Hz with 8 faults in under 30 s", elapsed < 30, f"{len(d):,} rows in {elapsed:.1f}s")

# ------------------------------------------------------------------------------------------
print("\n10) API (FastAPI TestClient)")
try:
    from fastapi.testclient import TestClient
    from app.main import app
except ImportError as e:
    print(f"  [SKIP] {e}. Run `pip install -r requirements.txt` to test the API.")
else:
    with TestClient(app) as client:
        r = client.get("/api/faults/catalog")
        check("GET /api/faults/catalog", r.status_code == 200 and len(r.json()["fault_types"]) == 8)

        plan = [{"type": "bearing_wear", "onset_s": 300, "ramp_s": 1200},
                {"type": "pocket_feeder_jam", "onset_s": 200, "ramp_s": 1400}]
        r = client.post("/api/simulate", json={"name": "faulty", "config": {"duration_s": 1800, "seed": 3},
                                               "faults": plan})
        check("POST /api/simulate with faults", r.status_code == 200, f"status {r.status_code}")
        run_ = r.json()
        rows = run_["preview"]["rows"]
        check("preview rows carry labels", all(c in rows[0] for c in LABEL_COLUMNS))
        check("labels reach the preview", any(x["fault_active"] == 1 for x in rows)
              and rows[0]["rul_s"] is not None)
        check("run config stores resolved faults", len(run_["config"]["faults"]) == 2
              and run_["config"]["faults"][0]["failure_s"] == 1500)
        check("run summary has label stats", run_["summary"]["labels"]["active_fraction"] > 0.3
              and run_["summary"]["labels"]["min_rul_s"] == 0.0)

        p = client.post("/api/faults/preview", json={"faults": plan, "duration_s": 1800, "seed": 3, "points": 600})
        check("POST /api/faults/preview", p.status_code == 200 and len(p.json()["t_s"]) == 600)
        pj = p.json()
        # with identical seed the instant preview must equal the real run's labels
        sev_prev = np.array(pj["faults"][0]["severity"]), np.array(pj["faults"][1]["severity"])
        dom = np.maximum(*sev_prev)
        real = np.array([x["fault_severity"] for x in rows])
        check("preview severity == simulated labels", len(rows) == 600 and np.allclose(
            np.where(dom > 0.05, dom, 0), real, atol=2e-3),
              f"max diff {np.abs(np.where(dom > 0.05, dom, 0) - real).max():.4f}")
        real_rul = np.array([np.nan if x["rul_s"] is None else x["rul_s"] for x in rows])
        prev_rul = np.array([np.nan if v is None else v for v in pj["rul_s"]])
        check("preview RUL == simulated RUL", np.allclose(real_rul, prev_rul, atol=0.2, equal_nan=True))

        lab = client.get(f"/api/runs/{run_['id']}/labels")
        types = {x["fault_type"] for x in lab.json()["segments"]} if lab.status_code == 200 else set()
        check("GET /api/runs/{id}/labels lists both faults", types == {"bearing_wear", "pocket_feeder_jam"},
              f"{len(lab.json().get('segments', []))} segments, types {sorted(types)}")
        profs = {x["fault_type"]: x["profile"] for x in lab.json()["segments"]} if lab.status_code == 200 else {}
        check("segments carry the run's profiles", profs.get("bearing_wear") == "gradual"
              and profs.get("pocket_feeder_jam") == "intermittent")
        check("labels endpoint can merge bursts", len(client.get(
            f"/api/runs/{run_['id']}/labels", params={"merge_gap_s": 600}).json()["segments"])
            <= len(lab.json()["segments"]))

        from app import database as db
        csv = pd.read_csv(db.get_run(run_["id"])["file_path"])
        check("CSV keeps 'none' as text and RUL numeric", not csv.fault_type.isna().any()
              and csv.rul_s.dtype.kind == "f" and "health_sealing" in csv.columns)
        data = client.get(f"/api/runs/{run_['id']}/data")
        check("GET /api/runs/{id}/data has labels", data.status_code == 200
              and "fault_type" in data.json()["rows"][0])

        healthy = client.post("/api/simulate", json={"config": {"duration_s": 600, "seed": 1}})
        check("healthy run: valid JSON with null RUL", healthy.status_code == 200
              and healthy.json()["preview"]["rows"][0]["rul_s"] is None
              and healthy.json()["summary"]["labels"]["active_fraction"] == 0.0)

        base_cfg = {"duration_s": 600}
        bad = {
            "unknown type": [{"type": "gremlins"}],
            "unknown profile": [{"type": "bearing_wear", "profile": "wobbly"}],
            "onset after run end": [{"type": "bearing_wear", "onset_s": 900}],
            "end before onset": [{"type": "bearing_wear", "onset_s": 100, "end_s": 50}],
            "intensity too high": [{"type": "bearing_wear", "intensity": 10}],
            "more than 8 faults": [{"type": "bearing_wear"}] * 9,
        }
        for label, faults in bad.items():
            check(f"rejects {label}", client.post(
                "/api/simulate", json={"config": base_cfg, "faults": faults}).status_code == 422)
        for rid in (run_["id"], healthy.json()["id"]):
            client.delete(f"/api/runs/{rid}")

        print("\n11) WebSocket: inject, repair, errors")

        def read_until(ws, pred, limit=80):
            for _ in range(limit):
                m = ws.receive_json()
                if pred(m):
                    return m
            return None

        with client.websocket_connect("/ws/stream") as ws:
            hello = ws.receive_json()
            check("hello carries the fault catalogue", len(hello.get("faults", {}).get("fault_types", [])) == 8)
            ws.send_json({"action": "speed", "value": 200})
            ws.send_json({"action": "inject", "fault": {"type": "vacuum_leak"}, "delay_s": 0})
            ack = read_until(ws, lambda m: m["type"] == "ack" and m["action"] == "inject")
            check("inject acknowledged with resolved fault", ack is not None and ack["fault"]["type"] == "vacuum_leak"
                  and ack["fault"]["profile"] == "sudden")
            tick = read_until(ws, lambda m: m["type"] == "tick" and any(r["fault_active"] == 1 for r in m["rows"]))
            row = [r for r in tick["rows"] if r["fault_active"] == 1][0] if tick else {}
            check("ticks show the injected fault label", tick is not None and row["fault_type"] == "vacuum_leak"
                  and row["fault_station"] == "forming")
            red = read_until(ws, lambda m: m["type"] == "tick" and m["rows"][-1]["status"]["forming"] == "red", 200)
            check("forming station turns red live", red is not None)
            ws.send_json({"action": "inject", "fault": {"type": "gremlins"}})
            err = read_until(ws, lambda m: m["type"] == "error")
            check("bad inject -> error message, socket stays open", err is not None and err["action"] == "inject")
            ws.send_json({"action": "repair"})
            rep = read_until(ws, lambda m: m["type"] == "ack" and m["action"] == "repair")
            check("repair acknowledged", rep is not None and rep["repaired"] == 1)
            clear = read_until(ws, lambda m: m["type"] == "tick" and all(r["fault_active"] == 0 for r in m["rows"]))
            check("labels clear after repair", clear is not None)
            ws.send_json({"action": "reset", "config": {"seed": 5},
                          "faults": [{"type": "punch_dulling", "profile": "sudden", "onset_s": 0}]})
            rst = read_until(ws, lambda m: m["type"] == "reset")
            check("reset with faults", rst is not None and len(rst["faults"]) == 1)
            t2 = read_until(ws, lambda m: m["type"] == "tick" and any(r["fault_type"] == "punch_dulling" for r in m["rows"]))
            check("reset fault is active from t=0", t2 is not None)

print("\nALL CHECKS PASSED" if ok else "\nSOME CHECKS FAILED")
sys.exit(0 if ok else 1)
