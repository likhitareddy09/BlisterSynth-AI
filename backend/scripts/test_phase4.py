"""Phase 4 test: window features, fault + RUL models, fidelity metrics, TSTR and the PdM/quality API.

    python scripts/test_phase4.py        (from backend/; needs torch + scikit-learn; about 3 minutes on CPU)
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("BLISTERSYNTH_DATA_DIR", tempfile.mkdtemp(prefix="blistersynth_test4_"))

import numpy as np

from app.generative import build_seed_set, train_cvae
from app.pdm import compare_runs, evaluate, predict_run, train, window_features
from app.pdm.data import make_runs, make_scenarios
from app.pdm.experiment import run_experiment
from app.pdm.features import SENSOR_KEYS
from app.pdm.quality import compare_sets
from app.simulator import FAULT_KEYS, SimConfig

ok = True


def check(name: str, cond: bool, detail: str = "") -> None:
    global ok
    ok &= bool(cond)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))


def with_seed(cfg: SimConfig, seed: int) -> SimConfig:
    return SimConfig(**{**cfg.to_dict(), "seed": seed})


def corrupt(df, scale=3.0):
    out = df.copy()
    rng = np.random.default_rng(0)
    for k in ("vib_x_mm_s", "sealing_temp_c", "motor_current_a"):
        out[k] = out[k] + rng.normal(0, scale * df[k].std(), len(df))
    return out


# ------------------------------------------------------------------------------------------
print("\n1) Window features and scenarios")
sc = make_scenarios(24, 1800, 7)
check("24 scenarios cover all 8 fault types", {f["type"] for _, fl in sc for f in fl} == set(FAULT_KEYS))
check("every 4th scenario is healthy", all(not fl for i, (_, fl) in enumerate(sc) if i % 4 == 0))
runs = make_runs(sc[:3])
df = runs[1]["df"]
F, idx = window_features(df, 60, 30)
check("3 features per sensor + speed_frac", F.shape[1] == 3 * len(SENSOR_KEYS) + 1, f"{F.shape[1]} columns")
check("no NaN, window ends are 30 s apart", not F.isna().any().any() and np.all(np.diff(idx) == 30) and idx[0] == 119)
try:
    window_features(df.iloc[:100], 60, 30)
    check("too-short run raises ValueError", False)
except ValueError:
    check("too-short run raises ValueError", True)

# ------------------------------------------------------------------------------------------
print("\n2) Fault classifier (train on physics, test on separate physics runs)")
t0 = time.time()
tr = make_runs(make_scenarios(60, 1800, 7))
te = make_runs(make_scenarios(16, 1800, 10007))
fb = train("fault", tr)
fm = evaluate(fb, te)
print(f"      {time.time() - t0:.0f}s   per-class recall: {fm['per_class_recall']}")
check("accuracy > 0.8", fm["accuracy"] > 0.8, f"{fm['accuracy']}")
check("fault-vs-none AUC > 0.95", fm["fault_vs_none_auc"] > 0.95, f"{fm['fault_vs_none_auc']}")
for k in ("bearing_wear", "vacuum_leak", "seal_pressure_leak", "punch_dulling"):
    check(f"{k} recall > 0.7", fm["per_class_recall"].get(k, 0) > 0.7, f"{fm['per_class_recall'].get(k)}")
d = fm["detection"]
check("detects at least 90 % of faults", d["detection_rate"] >= 0.9, f"{d['detection_rate']} of {d['n_faults']}")
check("false alarm rate < 5 %", d["false_alarm_rate"] < 0.05, f"{d['false_alarm_rate']}")
check("median detection delay < 300 s", d["median_delay_s"] < 300, f"{d['median_delay_s']} s")
pr = predict_run(fb, te[1]["df"])
check("predict_run returns aligned lists", len(pr["t_s"]) == len(pr["predicted"]) == len(pr["p_fault"]) > 10)

# ------------------------------------------------------------------------------------------
print("\n3) RUL regressor")
t0 = time.time()
rb, rm, _ = run_experiment("rul", None, n_train=120, n_test=20, seed=7)
print(f"      {time.time() - t0:.0f}s   {rm}")
check("RUL beats the predict-the-mean baseline by a wide margin", rm["mae_s"] < 0.6 * rm["baseline_mae_s"], f"MAE {rm['mae_s']} vs {rm['baseline_mae_s']}")
check("RUL R2 > 0.5", rm["r2"] > 0.5, f"{rm['r2']}")
pr = predict_run(rb, te[1]["df"])
check("RUL predictions within [0, cap]", 0 <= min(pr["rul_s"]) and max(pr["rul_s"]) <= rb.rul_cap_s)

# ------------------------------------------------------------------------------------------
print("\n4) Fidelity metrics")
t0 = time.time()
cvae, _ = train_cvae(build_seed_set(24, 1800, 11), epochs=40, seed=0)
print(f"      cVAE trained in {time.time() - t0:.0f}s")
cfg, faults = make_scenarios(2, 3600, 99)[1]
base = make_runs([(cfg, faults)])[0]["df"]
other = make_runs([(with_seed(cfg, 12345), faults)])[0]["df"]
gen = make_runs([(cfg, faults)], model=cvae)[0]["df"]
s_self, s_pp, s_cv, s_bad = (compare_runs(base, x)["score"] for x in (base, other, gen, corrupt(base)))
print(f"      self {s_self} | physics other seed {s_pp} | cVAE {s_cv} | noise x3 on 3 sensors {s_bad}")
check("identical runs score ~100", s_self > 99)
check("same scenario, other physics seed scores well above corrupted data", s_pp > s_bad + 8)
check("physics (other seed) scores at least as well as the cVAE", s_pp >= s_cv)
c = compare_runs(base, corrupt(base))
check("corruption is caught on the corrupted sensors", c["sensors"]["vib_x_mm_s"]["std_ratio"] > 1.5)

sc6 = make_scenarios(6, 1800, 501)
real6 = [r["df"] for r in make_runs(sc6)]
pp6 = [r["df"] for r in make_runs([(with_seed(c_, c_.seed + 1), f) for c_, f in sc6])]
cv6 = [r["df"] for r in make_runs(sc6, model=cvae)]
bad6 = [corrupt(x) for x in real6]
S_pp, S_cv, S_bad = compare_sets(real6, pp6), compare_sets(real6, cv6), compare_sets(real6, bad6)
print(f"      sets: physics-vs-physics AUC {S_pp['discriminator_auc']} score {S_pp['score']} | cVAE AUC {S_cv['discriminator_auc']} score {S_cv['score']} | corrupted AUC {S_bad['discriminator_auc']} score {S_bad['score']}")
check("discriminator cannot separate two physics seeds (held-out runs)", S_pp["discriminator_auc"] < 0.75, f"AUC {S_pp['discriminator_auc']}")
check("discriminator separates corrupted data", S_bad["discriminator_auc"] > 0.9, f"AUC {S_bad['discriminator_auc']}")
check("cVAE is easier to tell apart than a second physics seed", S_cv["discriminator_auc"] > S_pp["discriminator_auc"])
check("set scores ordered: physics > cVAE, physics > corrupted", S_pp["score"] > S_cv["score"] and S_pp["score"] > S_bad["score"])

# ------------------------------------------------------------------------------------------
print("\n5) TSTR: train on cVAE data, test on physics")
t0 = time.time()
_, phys_f, test_runs = run_experiment("fault", None, n_train=120, n_test=20, seed=7)
_, syn_f, _ = run_experiment("fault", cvae, n_train=120, n_test=20, seed=7, test_runs=test_runs)
print(f"      {time.time() - t0:.0f}s   fault macro-F1 physics-trained {phys_f['macro_f1']} vs synthetic-trained {syn_f['macro_f1']}")
check("synthetic-trained fault model keeps >= 80 % of the physics-trained macro-F1", syn_f["macro_f1"] >= 0.8 * phys_f["macro_f1"])
check("synthetic-trained model still detects the faults", syn_f["detection"]["detection_rate"] >= 0.9, f"false alarms {syn_f['detection']['false_alarm_rate']}")
_, syn_r, _ = run_experiment("rul", cvae, n_train=120, n_test=20, seed=7)
print(f"      RUL MAE physics-trained {rm['mae_s']} s vs synthetic-trained {syn_r['mae_s']} s (mean-guess {syn_r['baseline_mae_s']} s)")
check("synthetic-trained RUL beats the baseline clearly", syn_r["mae_s"] < 0.7 * syn_r["baseline_mae_s"] and syn_r["r2"] > 0.3, f"R2 {syn_r['r2']}")

# ------------------------------------------------------------------------------------------
print("\n6) PdM + quality API")
from fastapi.testclient import TestClient
from app.generative import store as gstore
from app.main import app

gmeta = gstore.save_model(cvae, {"name": "test cvae", "kind": "cvae"})
with TestClient(app) as client:
    check("API reports a version >= 0.4.0", tuple(int(x) for x in client.get("/api/health").json()["version"].split(".")) >= (0, 4, 0))
    check("no PdM models yet", client.get("/api/pdm/models").json() == [])
    r = client.post("/api/pdm/train", json={"task": "fault", "name": "api fault", "n_train_runs": 24, "n_test_runs": 8, "duration_s": 1200})
    check("train fault model returns metrics", r.status_code == 200 and r.json()["id"].startswith("pdm_") and "accuracy" in r.json()["metrics"], r.text[:150] if r.status_code != 200 else "")
    fault_id = r.json()["id"]
    r = client.post("/api/pdm/train", json={"task": "rul", "name": "api rul", "n_train_runs": 100, "n_test_runs": 10})
    check("train RUL model returns metrics", r.status_code == 200 and "mae_s" in r.json()["metrics"], r.text[:150] if r.status_code != 200 else "")
    rul_id = r.json()["id"]
    check("models listed and fetchable", len(client.get("/api/pdm/models").json()) == 2 and client.get(f"/api/pdm/models/{fault_id}").json()["task"] == "fault")

    sim = client.post("/api/simulate", json={"name": "wear", "config": {"duration_s": 3600, "seed": 5},
                                             "faults": [{"type": "bearing_wear", "onset_s": 600, "ramp_s": 2400, "intensity": 1.5}]}).json()
    p = client.post("/api/pdm/predict", json={"model_id": fault_id, "run_id": sim["id"]}).json()
    check("fault predict: healthy start, fault at the end", p["predicted"][2] == "none" and p["predicted"][-5:].count("bearing_wear") >= 3 and p["p_fault"][-3] > 0.8)
    q = client.post("/api/pdm/predict", json={"model_id": rul_id, "run_id": sim["id"]}).json()
    t, rul = np.array(q["t_s"]), np.array(q["rul_s"])
    check("RUL predict: values in [0, cap] and falling toward failure", rul.min() >= 0 and rul.max() <= q["rul_cap_s"] and rul[(t > 2700) & (t < 3000)].mean() < rul[(t > 700) & (t < 1500)].mean(),
          f"{rul[(t > 700) & (t < 1500)].mean():.0f} s -> {rul[(t > 2700) & (t < 3000)].mean():.0f} s")

    r = client.post("/api/pdm/tstr", json={"task": "fault", "model_id": gmeta["id"], "n_train_runs": 24, "n_test_runs": 8, "duration_s": 1200})
    check("tstr endpoint returns both experiments", r.status_code == 200 and {"physics_to_physics", "synthetic_to_physics", "summary"} <= set(r.json()), r.text[:150] if r.status_code != 200 else "")
    r = client.post("/api/pdm/train", json={"task": "fault", "train_source": gmeta["id"], "n_train_runs": 24, "n_test_runs": 8, "duration_s": 1200})
    check("train on generative-model data works", r.status_code == 200 and r.json()["train_source"] == gmeta["id"])

    gen_run = client.post("/api/generative/generate", json={"name": "syn wear", "model_id": gmeta["id"], "config": {"duration_s": 3600, "seed": 5},
                                                            "faults": [{"type": "bearing_wear", "onset_s": 600, "ramp_s": 2400, "intensity": 1.5}]}).json()
    c = client.post("/api/quality/compare", json={"real_run_id": sim["id"], "synthetic_run_id": gen_run["id"]})
    check("quality/compare returns a score and components", c.status_code == 200 and 0 <= c.json()["score"] <= 100 and {"marginals", "scale", "correlation", "temporal"} <= set(c.json()["components"]))
    e = client.post("/api/quality/evaluate-model", json={"model_id": gmeta["id"], "n_runs": 6, "duration_s": 900})
    check("evaluate-model returns discriminator AUC and score", e.status_code == 200 and e.json()["discriminator_auc"] is not None and e.json()["n_pairs"] == 6, e.text[:150] if e.status_code != 200 else "")

    short = client.post("/api/simulate", json={"name": "short", "config": {"duration_s": 120, "include_startup": False, "include_shutdown": False}}).json()
    check("too-short run -> 422", client.post("/api/pdm/predict", json={"model_id": fault_id, "run_id": short["id"]}).status_code == 422)
    check("unknown PdM model / run -> 404", client.post("/api/pdm/predict", json={"model_id": "pdm_nope", "run_id": sim["id"]}).status_code == 404
          and client.post("/api/pdm/predict", json={"model_id": fault_id, "run_id": "run_nope"}).status_code == 404)
    check("unknown or wrong-kind source model -> 404", client.post("/api/pdm/train", json={"train_source": "mdl_nope"}).status_code == 404
          and client.post("/api/pdm/train", json={"train_source": fault_id}).status_code == 404)
    check("bad task / too few runs -> 422", client.post("/api/pdm/train", json={"task": "x"}).status_code == 422
          and client.post("/api/pdm/train", json={"n_train_runs": 3}).status_code == 422)
    check("quality: unknown run -> 404", client.post("/api/quality/compare", json={"real_run_id": "run_nope", "synthetic_run_id": sim["id"]}).status_code == 404)
    check("delete PdM model works once", client.delete(f"/api/pdm/models/{fault_id}").status_code == 200 and client.delete(f"/api/pdm/models/{fault_id}").status_code == 404)

print("\n" + ("ALL CHECKS PASSED" if ok else "SOME CHECKS FAILED"))
sys.exit(0 if ok else 1)
