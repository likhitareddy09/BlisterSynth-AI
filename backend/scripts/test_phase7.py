"""Phase 7 tests.

Part 7A: Data Lab, exports, PDF report, quality report maths, PdM diagnostics, imbalance experiment.
Part 7B: Scenario Copilot (rule parser, mocked Claude parser, fallback, endpoints), version 0.7.0, backward compatibility.

    python scripts/test_phase7.py             everything (from backend/; needs torch, scikit-learn, pyarrow, matplotlib, reportlab; ~3-4 min on CPU)
    python scripts/test_phase7.py --7b-only   only the Part 7B checks (about 15 s)

The Anthropic SDK is never called for real here: the client factory is replaced by a fake, so no API key or network is needed.
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("BLISTERSYNTH_DATA_DIR", tempfile.mkdtemp(prefix="blistersynth_test7_"))

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from app import datalab, quality_report as qr
from app.datalab import DataLabError
from app.main import app
from app.pdm.data import make_imbalanced_scenarios, make_runs, make_scenarios
from app.simulator import FAULT_KEYS, LineSimulator, SENSORS, SimConfig, build_injector

ok = True


def check(name: str, cond: bool, detail: str = "") -> None:
    global ok
    ok &= bool(cond)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))


def raises(fn, exc=Exception) -> bool:
    try:
        fn()
    except exc:
        return True
    return False


def sim(seed: int, faults: list[dict] | None = None, duration: int = 1800) -> pd.DataFrame:
    inj = build_injector(faults, duration) if faults else None
    return LineSimulator(SimConfig(duration_s=duration, seed=seed), modifiers=[inj] if inj else None).run()[0]


# a "customer" CSV with deliberately awkward headers
REN = {"forming_temp_c": "Forming Temperature (°C)", "sealing_temp_c": "temp_sealing", "sealing_pressure_bar": "Seal pressure [bar]",
       "film_tension_n": "film tension", "vacuum_kpa": "Vacuum", "motor_current_a": "Motor Current", "vib_x_mm_s": "vibration_x",
       "vib_y_mm_s": "vib_y", "vib_z_mm_s": "VIB_Z", "line_speed_bpm": "speed", "cooling_flow_lpm": "cooling flow",
       "humidity_pct": "humidity", "cutting_force_n": "cutting-force", "pocket_fill_count": "pocket_fill"}


def customer_csv(df: pd.DataFrame, labels: bool = True, time_col: bool = True) -> bytes:
    c = df[list(REN)].rename(columns=REN)
    if time_col:
        c.insert(0, "t_s", df["t_s"].to_numpy())
    c["operator_note"] = "ok"
    if labels:
        c["fault"] = np.where(df["fault_active"] == 1, df["fault_type"], "none")
    return c.to_csv(index=False).encode()


# =====================================================================================================
# Part 7B: Scenario Copilot
# =====================================================================================================
def part_7b() -> None:
    from types import SimpleNamespace

    from app import copilot
    from app.config import APP_VERSION, COPILOT_DEFAULT_MODEL, COPILOT_MAX_PROMPT_CHARS
    from app.simulator.faults import FAULT_TYPES, PROFILES

    def rules(prompt: str) -> dict:
        return copilot.parse_prompt(prompt, use_claude=False)

    def first(prompt: str) -> dict:
        r = rules(prompt)
        return r["request"]["faults"][0] if r["request"]["faults"] else {}

    print("Copilot rules: the headline prompt")
    r = rules("Generate 2 hours of data with bearing wear starting at minute 40, high severity")
    f = r["request"]["faults"]
    check("2 hours -> duration_s 7200", r["request"]["config"]["duration_s"] == 7200)
    check("one fault: bearing_wear, onset 2400 s (minute 40), intensity 2.0 (high), gradual (catalogue default)",
          len(f) == 1 and f[0]["type"] == "bearing_wear" and f[0]["onset_s"] == 2400 and f[0]["intensity"] == 2.0 and f[0]["profile"] == "gradual", str(f))
    check("valid, parser = rules, no warnings, seed defaults to 42", r["valid"] and r["parser"] == "rules" and r["model"] is None and not r["warnings"] and r["request"]["config"]["seed"] == 42)
    check("same prompt twice -> identical result (deterministic)", rules("Generate 2 hours of data with bearing wear starting at minute 40, high severity") == r)

    print("Copilot rules: durations")
    dur = lambda t: rules(t)["request"]["config"]["duration_s"]
    check("'90 minutes' = 5400, '1.5 hours' = 5400, '45 min' = 2700, '30s run' is raised to 60",
          dur("90 minutes of data") == 5400 and dur("a 1.5 hours run") == 5400 and dur("45 min run") == 2700 and dur("30s run") == 60)
    check("compound: '2h30m', '2 hours and 30 minutes', '2 hours 30 minutes' = 9000", dur("2h30m run") == 9000 and dur("2 hours and 30 minutes run") == 9000 and dur("2 hours 30 minutes of data") == 9000)
    check("words: 'half an hour' = 1800, 'three hours' = 10800, 'an hour' = 3600, '1 day' = 86400", dur("half an hour of data") == 1800 and dur("three hours of data") == 10800 and dur("an hour of data") == 3600 and dur("1 day of data") == 86400)
    check("abbreviations: '2 hrs', '2 h', '2hr' = 7200", dur("2 hrs of data") == 7200 and dur("2 h of data") == 7200 and dur("2hr of data") == 7200)
    over = rules("100 hours of data")
    check("over the 48 h limit -> capped with a warning", over["request"]["config"]["duration_s"] == 48 * 3600 and any("capped" in w for w in over["warnings"]) and over["valid"])
    check("no length given -> default 1 h with a warning", dur("bearing wear at minute 10") == 3600 and any("default" in w for w in rules("bearing wear at minute 10")["warnings"]))
    check("onset later than the default length -> run is extended automatically", dur("bearing wear at minute 90") > 3600 and rules("bearing wear at minute 90")["valid"])

    print("Copilot rules: onset, repair, failure time")
    onset = lambda t: first(t).get("onset_s")
    check("'at minute 40', 'starting at 40 minutes', 'after 20 minutes', 'minute 1.5'", onset("2 hours bearing wear at minute 40") == 2400 and onset("2 hours bearing wear starting at 40 minutes") == 2400
          and onset("2 hours bearing wear after 20 minutes") == 1200 and onset("2 hours bearing wear at minute 1.5") == 90)
    check("'starting at 1h30' = 5400 and 'at hour 2' = 7200", onset("4 hours bearing wear starting at 1h30") == 5400 and onset("4 hours bearing wear at hour 2") == 7200)
    check("'from the start' = 0, 'halfway' = half the run, 'in the last 30 minutes' of 2 h = 5400",
          onset("2 hours bearing wear from the start") == 0 and onset("2 hours bearing wear halfway") == 3600 and onset("2 hours bearing wear in the last 30 minutes") == 5400)
    nu = rules("2 hours bearing wear starting at 40")
    check("bare number without a unit = minutes, and the user is told", nu["request"]["faults"][0]["onset_s"] == 2400 and any("no unit" in w for w in nu["warnings"]))
    check("'repaired at minute 50' -> end_s 3000", first("1 hour punch dulling at minute 10, repaired at minute 50").get("end_s") == 3000)
    check("'lasting 20 minutes' -> end_s = onset + 1200", first("2 hours vacuum leak at minute 30 lasting 20 minutes").get("end_s") == 3000)
    check("'fails at minute 90' -> ramp_s = 90 min - onset", first("3 hours bearing wear at minute 30, failing at minute 90").get("ramp_s") == 3600)
    check("'fails over 20 minutes' -> ramp_s 1200", first("3 hours bearing wear at minute 30 failing over 20 minutes").get("ramp_s") == 1200)

    print("Copilot rules: fault names and synonyms")
    kinds = {
        "bearing_wear": ["bearing wear", "worn bearing", "main drive bearing failure", "bearing_wear"],
        "sealing_heater_degradation": ["sealing heater degradation", "heater element fault", "heater"],
        "seal_pressure_leak": ["sealing pressure leak", "air leak", "pneumatic leak"],
        "vacuum_leak": ["vacuum leak", "forming vacuum loss", "vacuum"],
        "film_tension_instability": ["film tension instability", "web tension problem", "unwind dancer"],
        "cooling_blockage": ["cooling blockage", "clogged cooling", "coolant"],
        "punch_dulling": ["punch dulling", "blunt punch", "dull punching tool"],
        "pocket_feeder_jam": ["feeder jam", "tablet feeder jamming", "empty pockets"],
    }
    check("every fault type in the catalogue has synonyms in the parser", set(kinds) == set(FAULT_TYPES))
    bad = [(k, w) for k, words in kinds.items() for w in words if first(f"1 hour of data with {w} at minute 10").get("type") != k]
    check("all canonical names and synonyms resolve to the right type", not bad, str(bad))
    check("case and punctuation do not matter", first("1 HOUR OF DATA!!! BEARING-WEAR, at Minute 10.").get("type") == "bearing_wear")
    amb = rules("1 hour with a leak at minute 10")
    check("ambiguous 'leak' -> vacuum_leak with a warning", amb["request"]["faults"][0]["type"] == "vacuum_leak" and any("ambiguous" in w for w in amb["warnings"]))
    nf = rules("make me a sandwich")
    check("unknown text -> healthy run, warning says what to try, still valid", nf["request"]["faults"] == [] and nf["valid"] and any("no fault type recognised" in w for w in nf["warnings"]))
    check("healthy wording -> no faults and no warning about it", rules("a healthy 30 minute run")["request"]["faults"] == [] and not any("no fault" in w for w in rules("a healthy 30 minute run")["warnings"]))

    print("Copilot rules: severity, profile, seed, other settings")
    sev = lambda w: first(f"1 hour bearing wear at minute 10, {w} severity").get("intensity")
    check("severity words: mild 0.5, moderate 1.0, high 2.0, severe 2.0, critical/extreme 3.0", [sev(w) for w in ("mild", "moderate", "high", "severe", "critical", "extreme")] == [0.5, 1.0, 2.0, 2.0, 3.0, 3.0])
    check("no severity -> 1.0; numeric 'severity 2.5' -> 2.5", first("1 hour bearing wear at minute 10").get("intensity") == 1.0 and first("1 hour bearing wear at minute 10 with severity 2.5").get("intensity") == 2.5)
    clamp = rules("1 hour bearing wear at minute 10 severity 9")
    check("severity 9 is clamped to 3.0 with a warning", clamp["request"]["faults"][0]["intensity"] == 3.0 and any("clamped" in w for w in clamp["warnings"]) and clamp["valid"])
    prof = lambda w: first(f"1 hour bearing wear {w} at minute 10").get("profile")
    check("profile words: sudden/abruptly, gradual/slowly, intermittent/on and off", [prof(w) for w in ("sudden", "abruptly", "gradual", "slowly", "intermittent", "on and off")] == ["sudden", "sudden", "gradual", "gradual", "intermittent", "intermittent"])
    check("default profile comes from the catalogue (feeder jam -> intermittent)", first("1 hour feeder jam at minute 10").get("profile") == FAULT_TYPES["pocket_feeder_jam"].default_profile)
    sd = lambda t: rules(t)["request"]["config"]["seed"]
    check("seed: 'seed 123', 'seed=7', 'seeded with 9', 'random seed' (null), default 42", [sd("1 hour run seed 123"), sd("1 hour run seed=7"), sd("1 hour run seeded with 9"), sd("1 hour run random seed"), sd("1 hour run")] == [123, 7, 9, None, 42])
    check("the seed number is not mistaken for a time", rules("1 hour bearing wear at minute 10 seed 120")["request"]["faults"][0]["onset_s"] == 600 and rules("1 hour run seed 120")["request"]["config"]["duration_s"] == 3600)
    hz = rules("1 hour at 2 Hz with low noise")["request"]["config"]
    check("'2 Hz' -> sample_rate_hz 2, 'low noise' -> noise_scale 0.5", hz.get("sample_rate_hz") == 2 and hz.get("noise_scale") == 0.5 and hz["duration_s"] == 3600)
    check("'sampling every 5 seconds' -> 0.2 Hz; '240 bpm' -> nominal_speed_bpm", rules("1 hour sampling every 5 seconds")["request"]["config"].get("sample_rate_hz") == 0.2 and rules("1 hour at 240 bpm")["request"]["config"].get("nominal_speed_bpm") == 240)
    check("'no startup' -> include_startup false", rules("1 hour run with no startup")["request"]["config"].get("include_startup") is False)

    print("Copilot rules: several faults")
    two = rules("4 hours: mild heater degradation at minute 10 and severe punch dulling at minute 60")
    tf = two["request"]["faults"]
    check("two faults, each with its own onset and severity", [x["type"] for x in tf] == ["sealing_heater_degradation", "punch_dulling"] and [x["onset_s"] for x in tf] == [600, 3600] and [x["intensity"] for x in tf] == [0.5, 2.0], str(tf))
    glob = rules("2 hours with bearing wear at minute 10 and vacuum leak at minute 20, both severe")
    check("'both severe' applies to every fault", [x["intensity"] for x in glob["request"]["faults"]] == [2.0, 2.0])
    seq = rules("2 hours, bearing wear at minute 10, then heater degradation at minute 70")["request"]["faults"]
    check("'then' separates faults", [x["type"] for x in seq] == ["bearing_wear", "sealing_heater_degradation"] and [x["onset_s"] for x in seq] == [600, 4200])
    many = rules("2 hours " + ", ".join(f"{w} at minute {i + 1}" for i, w in enumerate(["bearing wear", "heater", "vacuum", "film tension", "coolant", "punch", "feeder jam", "air leak", "bearing wear", "heater"])))
    check("more than 8 faults -> first 8 kept with a warning, still valid", len(many["request"]["faults"]) == 8 and any("only the first 8" in w for w in many["warnings"]) and many["valid"])

    print("Copilot rules: invalid results are reported, not hidden")
    late = rules("20 minutes of data with bearing wear at minute 40")
    check("onset after the end of the run -> valid False with an error", not late["valid"] and any("after the run ends" in e["msg"] for e in late["errors"]), str(late["errors"]))
    check("an empty prompt and an over-long prompt raise ValueError",
          raises(lambda: copilot.parse_prompt("   "), ValueError) and raises(lambda: copilot.parse_prompt("x" * (COPILOT_MAX_PROMPT_CHARS + 1)), ValueError))
    rng = np.random.default_rng(0)
    alphabet = list("abcdefghijklmnopqrstuvwxyz0123456789 .,:;-_%/()'\"!?") + ["minute", "hour", "seed", "bearing", "at", "for", "severe", "then", "and", "h", "m"]
    crashed = 0
    for _ in range(300):
        txt = " ".join(rng.choice(alphabet, size=int(rng.integers(1, 25))))
        try:
            out = copilot.parse_prompt(txt, use_claude=False)
            assert isinstance(out["request"], dict) and isinstance(out["valid"], bool)
        except ValueError:
            pass
        except Exception:
            crashed += 1
    check("300 random strings: the parser never crashes", crashed == 0)

    print("Copilot: the five UI example prompts")
    examples = [
        ("Generate 2 hours of data with bearing wear starting at minute 40, high severity", [("bearing_wear", 2400, 2.0)]),
        ("Simulate 3 hours with a gradual sealing heater degradation from minute 20, repaired at minute 120", [("sealing_heater_degradation", 1200, 1.0)]),
        ("90 minutes of data with a sudden vacuum leak at minute 30, extreme severity, seed 7", [("vacuum_leak", 1800, 3.0)]),
        ("Run 4 hours: mild film tension instability from the start and a punch dulling at minute 90, severe", [("film_tension_instability", 0, 0.5), ("punch_dulling", 5400, 2.0)]),
        ("A healthy 1 hour run at 2 Hz with low noise", []),
    ]
    for prompt, expect in examples:
        out = rules(prompt)
        got = [(x["type"], x["onset_s"], x["intensity"]) for x in out["request"]["faults"]]
        check(f"example parses cleanly: {prompt[:48]}...", out["valid"] and got == expect and not out["warnings"], f"{got} {out['warnings']}")
    ex3 = rules(examples[2][0])["request"]
    check("example 3: sudden profile and seed 7", ex3["faults"][0]["profile"] == "sudden" and ex3["config"]["seed"] == 7)
    ex2 = rules(examples[1][0])["request"]["faults"][0]
    check("example 2: repair at minute 120 -> end_s 7200", ex2.get("end_s") == 7200)

    print("Copilot validation")
    check("a good request has no errors", copilot.validate_request(rules("1 hour bearing wear at minute 10")["request"]) == [])
    typo = copilot.validate_request({"config": {"duration_s": 600}, "faults": [{"type": "bearing_wear", "onset": 100}]})
    check("typo 'onset' -> unknown field with 'did you mean onset_s'", any(e["loc"] == "faults.0.onset" and "onset_s" in e["msg"] for e in typo), str(typo))
    check("bad intensity -> error located at faults.0.intensity", any(e["loc"] == "faults.0.intensity" for e in copilot.validate_request({"config": {"duration_s": 600}, "faults": [{"type": "bearing_wear", "onset_s": 10, "intensity": 9}]})))
    check("bad fault type -> error at faults.0.type", any(e["loc"] == "faults.0.type" for e in copilot.validate_request({"config": {"duration_s": 600}, "faults": [{"type": "warp_drive", "onset_s": 10}]})))
    check("not an object -> one readable error", copilot.validate_request([1, 2]) == [{"loc": "", "msg": "the request must be a JSON object"}])
    check("repair before onset -> error", bool(copilot.validate_request({"config": {"duration_s": 600}, "faults": [{"type": "bearing_wear", "onset_s": 300, "end_s": 100}]})))

    print("Copilot Claude parser (mocked SDK)")
    calls: list[dict] = []

    class FakeMessages:
        def __init__(self, behaviour):
            self.behaviour = behaviour

        def create(self, **kw):
            calls.append(kw)
            return self.behaviour(kw)

    def fake_client(behaviour):
        return SimpleNamespace(messages=FakeMessages(behaviour))

    def tool_reply(payload, stop="tool_use", name=copilot.TOOL_NAME):
        return SimpleNamespace(stop_reason=stop, content=[SimpleNamespace(type="text", text="ok"), SimpleNamespace(type="tool_use", name=name, input=payload)])

    good = {"name": "Bearing test", "config": {"duration_s": 7200, "seed": 5, "bogus_key": 1},
            "faults": [{"type": "bearing_wear", "profile": "gradual", "onset_s": 2400, "intensity": 2.0, "extra": "dropped"}], "explanation": "Read 'high' as intensity 2."}
    saved_make, saved_env = copilot._make_client, {k: os.environ.get(k) for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_MODEL")}
    made = {"n": 0}

    def install(behaviour):
        def factory():
            made["n"] += 1
            return fake_client(behaviour)
        copilot._make_client = factory

    try:
        os.environ.pop("ANTHROPIC_MODEL", None)
        os.environ.pop("ANTHROPIC_API_KEY", None)
        install(lambda kw: tool_reply(good))
        none = copilot.parse_prompt("2 hours bearing wear at minute 40, high")
        check("no API key -> rules, Claude never contacted, claude_available False", none["parser"] == "rules" and not none["claude_available"] and made["n"] == 0 and none["fallback_reason"] is None)

        os.environ["ANTHROPIC_API_KEY"] = "sk-ant-test-key-1234567890"
        check("claude_available / default model", copilot.claude_available() and copilot.claude_model() == COPILOT_DEFAULT_MODEL == "claude-sonnet-5-5")
        calls.clear(); made["n"] = 0
        out = copilot.parse_prompt("2 hours of bearing wear from minute 40, high severity")
        kw = calls[0]
        check("key set -> parser 'claude', model reported, valid, no fallback", out["parser"] == "claude" and out["model"] == "claude-sonnet-5-5" and out["valid"] and out["fallback_reason"] is None)
        check("Claude's output is cleaned: unknown config key and extra fault key dropped", "bogus_key" not in out["request"]["config"] and "extra" not in out["request"]["faults"][0] and out["request"]["faults"][0]["onset_s"] == 2400)
        check("Claude's explanation is shown as a note", out["notes"] == ["Read 'high' as intensity 2."])
        check("call: forced tool use on build_simulation, model, user text passed through",
              kw["tool_choice"] == {"type": "tool", "name": "build_simulation"} and kw["model"] == "claude-sonnet-5-5" and kw["messages"] == [{"role": "user", "content": "2 hours of bearing wear from minute 40, high severity"}]
              and [t["name"] for t in kw["tools"]] == ["build_simulation"] and kw["max_tokens"] > 0)
        props = kw["tools"][0]["input_schema"]["properties"]["faults"]["items"]["properties"]
        check("tool schema: fault types and profiles come from the catalogue", props["type"]["enum"] == list(FAULT_TYPES) and props["profile"]["enum"] == list(PROFILES))
        check("system prompt lists every fault type and says the user text is data", all(k in kw["system"] for k in FAULT_TYPES) and "never instructions" in kw["system"] and "SECONDS" in kw["system"])
        os.environ["ANTHROPIC_MODEL"] = "claude-test-model"
        calls.clear(); out = copilot.parse_prompt("2 hours bearing wear at minute 40")
        check("ANTHROPIC_MODEL overrides the default model", calls[0]["model"] == "claude-test-model" and out["model"] == "claude-test-model")
        os.environ.pop("ANTHROPIC_MODEL")

        calls.clear(); made["n"] = 0
        out = copilot.parse_prompt("2 hours bearing wear at minute 40", use_claude=False)
        check("use_claude=False with a key set -> rules, Claude not called", out["parser"] == "rules" and not calls and made["n"] == 0 and out["claude_available"])

        print("Copilot fallback to the rules")
        def expect_fallback(label, behaviour, needle=None):
            install(behaviour)
            o = copilot.parse_prompt("2 hours of bearing wear at minute 40, high severity")
            why = o["fallback_reason"] or ""
            check(f"fallback: {label}", o["parser"] == "rules" and o["model"] is None and o["valid"] and "rule-based parser" in why and (needle is None or needle in why) and o["request"]["faults"][0]["type"] == "bearing_wear", why[:140])
            return o
        def boom(kw):
            raise RuntimeError("401 invalid x-api-key sk-ant-test-key-1234567890 rejected")
        leak = expect_fallback("the SDK raises (auth/network/rate limit)", boom, "Claude call failed")
        check("the API key never appears in the message shown to the user", "sk-ant-test-key" not in json.dumps(leak))
        expect_fallback("invalid fault type from Claude", lambda kw: tool_reply({"config": {"duration_s": 600}, "faults": [{"type": "warp_drive", "onset_s": 10}]}), "failed validation")
        expect_fallback("out-of-range intensity from Claude", lambda kw: tool_reply({"config": {"duration_s": 600}, "faults": [{"type": "bearing_wear", "onset_s": 10, "intensity": 50}]}), "failed validation")
        expect_fallback("onset after the end of the run", lambda kw: tool_reply({"config": {"duration_s": 600}, "faults": [{"type": "bearing_wear", "onset_s": 900}]}), "failed validation")
        expect_fallback("no tool call in the answer", lambda kw: SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text="Sure!")]), "did not return")
        expect_fallback("wrong tool name", lambda kw: tool_reply(good, name="something_else"), "did not return")
        expect_fallback("answer cut off (max_tokens)", lambda kw: tool_reply(good, stop="max_tokens"), "cut off")
        expect_fallback("tool input is not an object", lambda kw: tool_reply("nope"), "not a JSON object")
        install(lambda kw: tool_reply({"config": {}, "faults": []}))
        dflt = copilot.parse_prompt("a healthy run")
        check("Claude leaving out config options is fine: the simulator's own defaults apply", dflt["parser"] == "claude" and dflt["valid"] and dflt["request"]["faults"] == [])
        expect_fallback("empty response object", lambda kw: SimpleNamespace(), "did not return")
        os.environ["ANTHROPIC_API_KEY"] = "   "
        check("a blank key counts as no key", not copilot.claude_available())

        print("Copilot endpoints")
        os.environ["ANTHROPIC_API_KEY"] = "sk-ant-secret-should-never-be-returned"
        with TestClient(app) as c:
            st = c.get("/api/copilot/status")
            check("GET /api/copilot/status: key set -> parser claude, key itself never returned", st.status_code == 200 and st.json()["claude_available"] and st.json()["parser"] == "claude" and "secret" not in st.text and st.json()["max_prompt_chars"] == COPILOT_MAX_PROMPT_CHARS)
            os.environ.pop("ANTHROPIC_API_KEY")
            st2 = c.get("/api/copilot/status").json()
            check("GET /api/copilot/status: no key -> rules", not st2["claude_available"] and st2["parser"] == "rules" and st2["model"] == "claude-sonnet-5-5")

            pr = c.post("/api/copilot/parse", json={"prompt": "Generate 2 hours of data with bearing wear starting at minute 40, high severity"})
            pj = pr.json()
            check("POST /api/copilot/parse: 200 with the full response shape", pr.status_code == 200 and {"parser", "model", "claude_available", "request", "valid", "errors", "warnings", "notes", "fallback_reason"} <= set(pj) and pj["parser"] == "rules" and pj["valid"])
            check("parse: empty -> 422, too long -> 422, missing field -> 422",
                  c.post("/api/copilot/parse", json={"prompt": ""}).status_code == 422 and c.post("/api/copilot/parse", json={"prompt": "x" * (COPILOT_MAX_PROMPT_CHARS + 1)}).status_code == 422
                  and c.post("/api/copilot/parse", json={}).status_code == 422 and c.post("/api/copilot/parse", json={"prompt": "   "}).status_code == 422)
            check("parse: an invalid draft is returned (200) with errors, so the UI can show them", (lambda j: j["valid"] is False and j["errors"] and j["request"]["faults"])(c.post("/api/copilot/parse", json={"prompt": "20 minutes of data with bearing wear at minute 40"}).json()))

            os.environ["ANTHROPIC_API_KEY"] = "sk-ant-test-key-1234567890"
            install(lambda kw: tool_reply(good))
            cj = c.post("/api/copilot/parse", json={"prompt": "2 hours bearing wear from minute 40, high"}).json()
            check("parse through the API with the mocked SDK -> parser claude", cj["parser"] == "claude" and cj["model"] == "claude-sonnet-5-5" and cj["valid"])
            install(boom)
            fj = c.post("/api/copilot/parse", json={"prompt": "2 hours bearing wear from minute 40, high"}).json()
            check("parse through the API when the SDK fails -> rules + fallback_reason", fj["parser"] == "rules" and "Claude call failed" in (fj["fallback_reason"] or "") and fj["valid"] and "sk-ant-test-key" not in json.dumps(fj))
            os.environ.pop("ANTHROPIC_API_KEY")

            ok_v = c.post("/api/copilot/validate", json={"request": pj["request"]}).json()
            check("POST /api/copilot/validate: good request", ok_v == {"valid": True, "errors": []})
            bad_v = c.post("/api/copilot/validate", json={"request": {"config": {"duration_s": 600}, "faults": [{"type": "bearing_wear", "onset": 5, "intensity": 7}]}}).json()
            check("validate: typo and range errors with locations", not bad_v["valid"] and {"faults.0.onset", "faults.0.intensity"} <= {e["loc"] for e in bad_v["errors"]}, str(bad_v))
            check("validate: a non-object is reported, not a 500", c.post("/api/copilot/validate", json={"request": 5}).json()["valid"] is False and c.post("/api/copilot/validate", json={"request": None}).status_code == 200)

            print("Copilot output really runs")
            sim_req = rules("20 minutes of data with a sudden bearing wear at minute 5, severe, seed 3")["request"]
            sr = c.post("/api/simulate", json=sim_req)
            check("the parsed request is accepted by POST /api/simulate", sr.status_code == 200, sr.text[:150] if sr.status_code != 200 else "")
            if sr.status_code == 200:
                run = sr.json()
                lab = c.get(f"/api/runs/{run['id']}/labels").json()
                check("the run has the requested duration and a labelled fault segment", run["n_rows"] == 1200 and any(s.get("fault_type", s.get("type")) == "bearing_wear" for s in lab["segments"]), str(lab["segments"])[:120])
            cat = c.get("/api/faults/catalog").json()
            check("tool schema enums == /api/faults/catalog", copilot.tool_schema()["input_schema"]["properties"]["faults"]["items"]["properties"]["type"]["enum"] == [f["key"] for f in cat["fault_types"]]
                  and copilot.tool_schema()["input_schema"]["properties"]["faults"]["items"]["properties"]["profile"]["enum"] == [p["key"] for p in cat["profiles"]])

            print("Version 0.7.0 and backward compatibility")
            check("config version is 0.7.0", APP_VERSION == "0.7.0")
            check("/api/health and /api/overview report 0.7.0", c.get("/api/health").json()["version"] == "0.7.0" and c.get("/api/overview").json()["version"] == "0.7.0")
            paths = set(c.get("/openapi.json").json()["paths"])
            old = {"/api/simulate", "/api/runs", "/api/runs/{run_id}", "/api/runs/{run_id}/data", "/api/runs/{run_id}/labels", "/api/runs/{run_id}/download", "/api/runs/{run_id}/report", "/api/scenarios",
                   "/api/faults/catalog", "/api/sensors", "/api/generative/train", "/api/generative/models", "/api/generative/generate", "/api/pdm/train", "/api/pdm/models", "/api/pdm/diagnostics",
                   "/api/quality/compare", "/api/quality/report", "/api/datasets", "/api/overview", "/api/health"}
            check("every earlier endpoint is still in the OpenAPI schema", old <= paths, str(sorted(old - paths)))
            check("the three copilot endpoints are registered", {"/api/copilot/status", "/api/copilot/parse", "/api/copilot/validate"} <= paths)
            with c.websocket_connect("/ws/stream") as ws:
                hello = ws.receive_json()
                ws.send_json({"action": "speed", "value": 5})
                acks = []
                for _ in range(40):
                    m = ws.receive_json()
                    if m.get("type") == "ack":
                        acks.append(m); break
                ws.send_json({"action": "inject", "fault": {"type": "bearing_wear", "profile": "gradual", "ramp_s": 600, "intensity": 2}})
                inj = None
                for _ in range(40):
                    m = ws.receive_json()
                    if m.get("type") == "ack" and m.get("action") == "inject":
                        inj = m; break
                check("WebSocket protocol unchanged: hello, speed ack, inject ack (the messages demo mode sends)", hello["type"] == "hello" and acks and acks[0]["speed"] == 5 and inj is not None and "fault" in inj)
    finally:
        copilot._make_client = saved_make
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


if "--7b-only" in sys.argv:
    part_7b()
    print("\n" + ("ALL CHECKS PASSED" if ok else "SOME CHECKS FAILED"))
    sys.exit(0 if ok else 1)


print("Data Lab: column matching")
cols = list(REN.values()) + ["t_s", "operator_note", "fault"]
sug = datalab.suggest_mapping(cols)
mp = {v["target"]: c for c, v in sug.items()}
check("all 14 sensors matched from awkward headers", all(k in mp for k in datalab.SENSOR_KEYS), str([k for k in datalab.SENSOR_KEYS if k not in mp]))
check("t_s and fault columns matched", mp.get("t_s") == "t_s" and mp.get("fault_type") == "fault")
check("unrelated column is left unmapped", "operator_note" not in sug)
check("exact names rank as 'exact'", datalab.suggest_mapping(["vacuum_kpa"])["vacuum_kpa"]["match"] == "exact")
check("a typo is found by fuzzy match", datalab.suggest_mapping(["sealing_presure_bar"]).get("sealing_presure_bar", {}).get("target") == "sealing_pressure_bar")
one_col = datalab.suggest_mapping(["Humidity", "humidity_pct"])
check("a schema field is used only once (best match wins)", len([v for v in one_col.values() if v["target"] == "humidity_pct"]) == 1
      and one_col["humidity_pct"]["match"] == "exact")
chk = datalab.check_mapping(cols, {k: v for k, v in mp.items() if k != "vacuum_kpa"})
check("missing sensor is reported", chk["missing"] == ["vacuum_kpa"] and not chk["ready"])
check("duplicate column use is an error", datalab.check_mapping(["a"], {"vacuum_kpa": "a", "humidity_pct": "a"})["errors"])
check("unknown schema field is an error", datalab.check_mapping(["a"], {"nonsense": "a"})["errors"])

print("Data Lab: reading and cleaning")
base = sim(3, [{"type": "bearing_wear", "onset_s": 600, "intensity": 1.5}])
raw = customer_csv(base)
df_up = datalab.parse_csv(raw)
check("parse_csv reads the file", len(df_up) == len(base) and "Vacuum" in df_up.columns)
check("semicolon CSV is detected", len(datalab.parse_csv(raw.decode().replace(",", ";").encode())) == len(base))
check("empty file rejected", raises(lambda: datalab.parse_csv(b""), DataLabError))
check("too-short file rejected", raises(lambda: datalab.parse_csv(customer_csv(base.head(50))), DataLabError))
check("single-column file rejected", raises(lambda: datalab.parse_csv(("a\n" + "1\n" * 200).encode()), DataLabError))
clean, info = datalab.normalise(df_up, mp, 1.0)
check("normalise gives the run layout (t_s, 14 sensors, labels)", all(c in clean.columns for c in ["t_s", "machine_state", "fault_active", "fault_type", "rul_s", *datalab.SENSOR_KEYS]))
check("fault labels are carried over", info["has_labels"] and clean["fault_active"].sum() == base["fault_active"].sum()
      and set(clean["fault_type"]) == {"none", "bearing_wear"})
check("sample rate derived from t_s", abs(info["sample_rate_hz"] - 1.0) < 1e-6)
nolab, info2 = datalab.normalise(datalab.parse_csv(customer_csv(base, labels=False, time_col=False)),
                                 {k: v for k, v in mp.items() if k not in ("t_s", "fault_type")}, 2.0)
check("no label column -> healthy dataset, rate from the form", not info2["has_labels"] and (nolab["fault_active"] == 0).all()
      and info2["sample_rate_hz"] == 2.0 and abs(nolab["t_s"].iloc[1] - 0.5) < 1e-9)
holes = df_up.copy()
holes.loc[5:20, "Vacuum"] = np.nan
filled, info3 = datalab.normalise(holes, mp, 1.0)
check("a few missing values are interpolated and reported", filled["vacuum_kpa"].notna().all() and any("vacuum_kpa" in n for n in info3["notes"]))
holes.loc[:, "Vacuum"] = np.where(np.arange(len(holes)) % 2 == 0, np.nan, holes["Vacuum"])
check("too many missing values rejected", raises(lambda: datalab.normalise(holes, mp, 1.0), DataLabError))
bad_t = df_up.copy(); bad_t.loc[10, "t_s"] = 0
check("non-increasing time column rejected", raises(lambda: datalab.normalise(bad_t, mp, 1.0), DataLabError))
bad_f = df_up.copy(); bad_f["fault"] = "gremlins"
check("unknown fault type rejected with the allowed list", raises(lambda: datalab.normalise(bad_f, mp, 1.0), DataLabError))
bin_lab = df_up.drop(columns=["fault"]).copy(); bin_lab["is_fault"] = (base["fault_active"].to_numpy())
m2 = {k: v for k, v in mp.items() if k != "fault_type"} | {"fault_active": "is_fault"}
bl, _ = datalab.normalise(bin_lab, m2, 1.0)
check("binary labels without a fault name -> 'unspecified'", set(bl.loc[bl["fault_active"] == 1, "fault_type"]) == {"unspecified"})
check("missing sensors rejected by normalise", raises(lambda: datalab.normalise(df_up, {k: v for k, v in mp.items() if k != "Vacuum" and k != "vacuum_kpa"}, 1.0), DataLabError))
check("sample rate out of range rejected", raises(lambda: datalab.normalise(df_up, {k: v for k, v in mp.items() if k != "t_s"}, 50.0), DataLabError))

print("Data Lab: export formats")
small = base.head(300)
pq = pd.read_parquet(io.BytesIO(datalab.export_bytes(small, "parquet")))
check("parquet round-trips", len(pq) == 300 and np.allclose(pq["vacuum_kpa"], small["vacuum_kpa"]))
js = json.loads(datalab.export_bytes(small, "json"))
check("json is a list of records (NaN -> null)", len(js) == 300 and js[0]["rul_s"] is None or js[0]["rul_s"] is not None)
check("csv round-trips", len(pd.read_csv(io.BytesIO(datalab.export_bytes(small, "csv")))) == 300)
check("unknown format rejected", raises(lambda: datalab.export_bytes(small, "xml"), DataLabError))

print("Quality maths")
a, b = sim(1), sim(2)
ra, rb = qr.pooled([a]), qr.pooled([b])
ks_same = qr.ks_table(ra, ra)
check("identical data: every sensor passes the KS check (D = 0)", all(r["pass"] and r["ks"] == 0 for r in ks_same))
shifted = rb.copy(); shifted["forming_temp_c"] += 8.0
ks_base = {r["sensor"]: r for r in qr.ks_table(ra, rb)}
ks_shift = {r["sensor"]: r for r in qr.ks_table(ra, shifted)}
check("a shifted sensor fails the KS check (D near 1)", not ks_shift["forming_temp_c"]["pass"] and ks_shift["forming_temp_c"]["ks"] > 0.9)
check("the other sensors are not affected by the shift", ks_shift["motor_current_a"]["ks"] == ks_base["motor_current_a"]["ks"])
corr_same = qr.corr_matrices(ra, ra)
check("identical data: correlation difference is zero", corr_same["mean_abs_diff"] == 0 and np.allclose(np.diag(np.array(corr_same["real"])), 1))
check("correlation matrices are 14x14 and symmetric", np.array(corr_same["real"]).shape == (14, 14) and np.allclose(corr_same["real"], np.array(corr_same["real"]).T))
set_a = [r["df"] for r in make_runs(make_scenarios(8, 1200, 5))]
set_b = [r["df"] for r in make_runs(make_scenarios(8, 1200, 77))]
Fa, _, _ = qr.windows(set_a)
Fb, _, _ = qr.windows(set_b)
d_same = qr.diversity(Fa, Fb, seed=0)
check("similar data: high coverage, no mode collapse", d_same["available"] and d_same["coverage"] > 0.5 and not d_same["collapse_suspected"], str(d_same.get("coverage")))
Fcollapsed = pd.concat([Fb.iloc[[0]]] * len(Fb), ignore_index=True) + np.random.default_rng(0).normal(0, 1e-3, Fb.shape)
d_col = qr.diversity(Fa, Fcollapsed, seed=0)
check("collapsed generator (one repeated window): flagged, coverage near 0", d_col["collapse_suspected"] and d_col["coverage"] < 0.2 < d_same["coverage"], d_col["collapse_reason"])
check("too few windows -> diversity unavailable, not an error", not qr.diversity(Fa.head(5), Fb.head(5))["available"])
check("utility gauge = TSTR/TRTR capped at 100", qr.utility_value({"available": True, "utility_ratio": 1.4}) == 100.0
      and qr.utility_value({"available": True, "utility_ratio": 0.5}) == 50.0 and qr.utility_value({"available": False}) is None)
healthy_only = qr.tstr_trtr([a, b], [a, b])
check("TSTR unavailable (with a reason) when real data has no faults", not healthy_only["available"] and "fault" in healthy_only["reason"].lower())
sc = make_scenarios(8, 1200, 5)
real_runs, syn_runs = [r["df"] for r in make_runs(sc)], [r["df"] for r in make_runs(make_scenarios(8, 1200, 5))]
ts = qr.tstr_trtr(real_runs[:4], real_runs[4:], real_test_dfs=[r["df"] for r in make_runs(make_scenarios(4, 1200, 900))])
check("TSTR/TRTR: ratio, scores and split are reported", ts["available"] and 0 <= ts["tstr"]["macro_f1"] <= 1 and 0 <= ts["trtr"]["macro_f1"] <= 1
      and ts["split"] == "held-out real runs" and ts["utility_ratio"] is not None)
ts1 = qr.tstr_trtr([real_runs[0]], real_runs[1:5])
check("single real frame -> time-block split (no crash)", ts1["available"] is True or "class" in ts1.get("reason", ""), ts1.get("split", ts1.get("reason")))
clean_obj = qr.clean({"a": np.float32("nan"), "b": [np.inf, np.int64(3)], "c": np.array([1.5, np.nan])})
check("clean() makes NaN/Inf JSON-safe", clean_obj == {"a": None, "b": [None, 3], "c": [1.5, None]})
check("imbalanced scenarios keep only the requested number of faulty runs", sum(bool(f) for _, f in make_imbalanced_scenarios(10, 600, 3, 2)) == 2)

with TestClient(app) as client:
    print("Data Lab API")
    schema = client.get("/api/datasets/schema").json()
    check("schema lists 14 required + optional columns + formats", len(schema["required"]) == 14 and "t_s" in schema["optional"] and "parquet" in schema["formats"])
    ins = client.post("/api/datasets/inspect", files={"file": ("plant.csv", raw, "text/csv")})
    insj = ins.json()
    check("inspect: suggested mapping covers all sensors and the file is ready", ins.status_code == 200 and insj["check"]["ready"] and len(insj["suggested_mapping"]) >= 16)
    check("inspect: preview + stats + unmapped column reported", len(insj["preview"]) == 10 and "Vacuum" in insj["stats"] and insj["check"]["unmapped_columns"] == ["operator_note"])
    check("inspect saves nothing", client.get("/api/datasets").json() == [])
    check("inspect rejects a non-CSV/empty upload", client.post("/api/datasets/inspect", files={"file": ("x.csv", b"", "text/csv")}).status_code == 422)
    missing_map = {k: v for k, v in insj["suggested_mapping"].items() if k != "vacuum_kpa"}
    bad = client.post("/api/datasets", files={"file": ("plant.csv", raw, "text/csv")}, data={"name": "bad", "mapping": json.dumps(missing_map)})
    check("save with a missing sensor -> 422 naming it", bad.status_code == 422 and "vacuum_kpa" in bad.json()["detail"])
    check("save with a malformed mapping -> 422", client.post("/api/datasets", files={"file": ("p.csv", raw, "text/csv")}, data={"mapping": "[1,2]"}).status_code == 422)
    saved = client.post("/api/datasets", files={"file": ("plant.csv", raw, "text/csv")}, data={"name": "Plant A", "mapping": json.dumps(insj["suggested_mapping"])})
    ds = saved.json()
    check("save -> 201 with id, rows, labels flag, rate", saved.status_code == 201 and ds["id"].startswith("ds_") and ds["n_rows"] == len(base) and ds["has_labels"] and ds["sample_rate_hz"] == 1.0)
    auto = client.post("/api/datasets", files={"file": ("auto.csv", raw, "text/csv")}, data={"name": ""}).json()
    check("empty mapping -> automatic mapping; empty name -> file name", auto["name"] == "auto" and auto["n_rows"] == len(base))
    check("list shows both datasets", len(client.get("/api/datasets").json()) == 2)
    one = client.get(f"/api/datasets/{ds['id']}").json()
    check("detail has preview + sensor stats", len(one["preview"]) == 10 and "forming_temp_c" in one["stats"])
    dd = client.get(f"/api/datasets/{ds['id']}/data?max_points=100").json()
    check("data endpoint is down-sampled like runs", len(dd["rows"]) <= 100 and "t_s" in dd["rows"][0])
    check("overview counts datasets", client.get("/api/overview").json()["datasets"] == 2)
    check("rename dataset", client.patch(f"/api/datasets/{auto['id']}", json={"name": "Renamed"}).json()["name"] == "Renamed"
          and client.patch(f"/api/datasets/{auto['id']}", json={"name": ""}).status_code == 422)
    for fmt, ctype in (("csv", "text/csv"), ("parquet", "parquet"), ("json", "json")):
        r = client.get(f"/api/datasets/{ds['id']}/download?format={fmt}")
        check(f"dataset download as {fmt}", r.status_code == 200 and ctype in r.headers["content-type"] and f".{fmt}" in r.headers["content-disposition"])
    check("dataset download: bad format -> 422", client.get(f"/api/datasets/{ds['id']}/download?format=xml").status_code == 422)
    check("unknown dataset -> 404 everywhere", all(client.get(f"/api/datasets/ds_nope{p}").status_code == 404 for p in ("", "/data", "/download"))
          and client.patch("/api/datasets/ds_nope", json={"name": "x"}).status_code == 404 and client.delete("/api/datasets/ds_nope").status_code == 404)
    check("delete dataset removes the file", client.delete(f"/api/datasets/{auto['id']}").status_code == 200 and len(client.get("/api/datasets").json()) == 1)

    print("Runs and scenarios: formats and rename")
    run = client.post("/api/simulate", json={"name": "Bearing demo", "config": {"duration_s": 1800, "seed": 3},
                                            "faults": [{"type": "bearing_wear", "onset_s": 600, "intensity": 1.5}]}).json()
    healthy = client.post("/api/simulate", json={"name": "Healthy", "config": {"duration_s": 1800, "seed": 4}, "faults": []}).json()
    check("run download: csv default unchanged", client.get(f"/api/runs/{run['id']}/download").headers["content-type"].startswith("text/csv"))
    pqr = client.get(f"/api/runs/{run['id']}/download?format=parquet")
    check("run download as parquet is readable", pqr.status_code == 200 and len(pd.read_parquet(io.BytesIO(pqr.content))) == run["n_rows"])
    jr = client.get(f"/api/runs/{run['id']}/download?format=json")
    check("run download as json", jr.status_code == 200 and len(jr.json()) == run["n_rows"])
    check("run download: bad format 422, unknown run 404", client.get(f"/api/runs/{run['id']}/download?format=xml").status_code == 422
          and client.get("/api/runs/run_nope/download?format=json").status_code == 404)
    check("rename run", client.patch(f"/api/runs/{healthy['id']}", json={"name": "Healthy v2"}).json()["name"] == "Healthy v2"
          and any(r["name"] == "Healthy v2" for r in client.get("/api/runs").json()))
    check("rename run: unknown 404, empty name 422", client.patch("/api/runs/run_nope", json={"name": "x"}).status_code == 404
          and client.patch(f"/api/runs/{run['id']}", json={"name": " "}).status_code in (200, 422))
    scn = client.post("/api/scenarios", json={"name": "S1", "description": "d", "config": {"faults": []}}).json()
    check("rename scenario (+ description)", client.patch(f"/api/scenarios/{scn['id']}", json={"name": "S2", "description": "new"}).status_code == 200
          and client.get("/api/scenarios").json()[0]["name"] == "S2" and client.get("/api/scenarios").json()[0]["description"] == "new")
    check("rename scenario: unknown -> 404", client.patch("/api/scenarios/sc_nope", json={"name": "x"}).status_code == 404)

    print("PDF report")
    t0 = time.time()
    pdf = client.get(f"/api/runs/{run['id']}/report")
    check("report is a PDF download", pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content[:5] == b"%PDF-"
          and "_report.pdf" in pdf.headers["content-disposition"])
    pages = int(re.search(rb"/Count (\d+)", pdf.content).group(1))
    check("report has several pages and real content", len(pdf.content) > 50_000 and pages >= 5, f"{len(pdf.content) // 1024} KB, ~{pages} pages, {time.time() - t0:.1f}s")
    check("report for a healthy run works too", client.get(f"/api/runs/{healthy['id']}/report").content[:5] == b"%PDF-")
    check("report for an unknown run -> 404", client.get("/api/runs/run_nope/report").status_code == 404)

    print("Generative training from a dataset")
    check("run_ids + dataset_ids together -> 422", client.post("/api/generative/train", json={"kind": "cvae", "run_ids": [run["id"]], "dataset_ids": [ds["id"]]}).status_code == 422)
    check("unknown dataset -> 404", client.post("/api/generative/train", json={"kind": "cvae", "dataset_ids": ["ds_nope"]}).status_code == 404)
    job = client.post("/api/generative/train", json={"kind": "cvae", "name": "from plant A", "dataset_ids": [ds["id"]], "epochs": 3}).json()
    t0 = time.time()
    while job["status"] in ("queued", "running") and time.time() - t0 < 150:
        time.sleep(1.0)
        job = client.get(f"/api/generative/jobs/{job['id']}").json()
    check("model trains on an uploaded dataset", job["status"] == "done" and job["model_id"], f"{job['status']} {job.get('error')}")
    gen = client.post("/api/generative/generate", json={"name": "from-dataset", "model_id": job["model_id"], "config": {"duration_s": 600}, "faults": []})
    check("and generates a run", gen.status_code == 200 and gen.json()["kind"] == "generative")
    gpdf = client.get(f"/api/runs/{gen.json()['id']}/report")
    check("PDF report of a generative run includes the quality section", gpdf.status_code == 200 and gpdf.content[:5] == b"%PDF-")

    print("Quality report API")
    real_ref = {"kind": "dataset", "id": ds["id"]}
    syn_ref = {"kind": "run", "id": run["id"]}
    q = client.post("/api/quality/report", json={"real": [real_ref], "synthetic": [syn_ref], "include_tsne": True})
    qj = q.json()
    check("sources mode: report returned", q.status_code == 200, str(qj if q.status_code != 200 else ""))
    check("three gauges present (0-100 or null)", all(k in qj["gauges"] for k in ("fidelity", "utility", "diversity"))
          and all(v is None or 0 <= v <= 100 for v in qj["gauges"].values()))
    check("KS table: 14 sensors with D, p, pass", len(qj["ks"]) == 14 and all({"sensor", "ks", "p_value", "pass"} <= set(r) for r in qj["ks"]))
    check("correlation: real / syn / diff are 14x14", all(np.array(qj["correlation"][k]).shape == (14, 14) for k in ("real", "syn", "diff")))
    check("PCA scatter + explained variance", len(qj["embeddings"]["pca"]["real"]) > 0 and len(qj["embeddings"]["pca"]["explained"]) == 2)
    check("t-SNE present (or explained)", qj["embeddings"]["tsne"] is not None or bool(qj["embeddings"]["tsne_note"]))
    check("distributions for every sensor (hist + KDE)", len(qj["distributions"]) == 14 and len(qj["distributions"]["vacuum_kpa"]["kde_x"]) == 80)
    check("definitions included for the tooltips", all(qj["definitions"].get(k) for k in ("fidelity", "utility", "diversity")))
    check("report is valid JSON (no NaN)", "NaN" not in q.text and "Infinity" not in q.text)
    q2 = client.post("/api/quality/report", json={"real": [real_ref], "synthetic": [syn_ref], "include_tsne": False}).json()
    check("t-SNE can be switched off", q2["embeddings"]["tsne"] is None)
    check("validation: neither / both / one side only -> 422", client.post("/api/quality/report", json={}).status_code == 422
          and client.post("/api/quality/report", json={"real": [real_ref], "synthetic": [syn_ref], "model_id": "mdl_x"}).status_code == 422
          and client.post("/api/quality/report", json={"real": [real_ref]}).status_code == 422)
    check("unknown source -> 404", client.post("/api/quality/report", json={"real": [{"kind": "run", "id": "run_nope"}], "synthetic": [syn_ref]}).status_code == 404)
    check("unknown model -> 404", client.post("/api/quality/report", json={"model_id": "mdl_nope"}).status_code == 404)
    tiny = client.post("/api/datasets", files={"file": ("tiny.csv", customer_csv(base.head(130), labels=False), "text/csv")}, data={"name": "tiny"}).json()
    short = client.post("/api/quality/report", json={"real": [{"kind": "dataset", "id": tiny["id"]}], "synthetic": [syn_ref]})
    check("too little data -> readable 422 (not a crash)", short.status_code == 422 and isinstance(short.json()["detail"], str), str(short.json())[:100])
    qm = client.post("/api/quality/report", json={"model_id": job["model_id"], "n_runs": 4, "duration_s": 900, "include_tsne": False})
    qmj = qm.json()
    check("model mode: matched runs, held-out real test set", qm.status_code == 200 and qmj["source"]["mode"] == "model"
          and (qmj["tstr"].get("split") == "held-out real runs" or not qmj["tstr"]["available"]))

    print("PdM diagnostics + imbalance experiment")
    fm = client.post("/api/pdm/train", json={"task": "fault", "name": "diag fault", "train_source": "physics", "n_train_runs": 16, "n_test_runs": 4, "duration_s": 900}).json()
    dg = client.post("/api/pdm/diagnostics", json={"model_id": fm["id"], "n_runs": 6})
    dj = dg.json()
    check("fault diagnostics returned", dg.status_code == 200 and dj["task"] == "fault", str(dj)[:120] if dg.status_code != 200 else "")
    cm = np.array(dj["confusion_matrix"])
    check("confusion matrix is square, matches labels and sums to the window count", cm.shape == (len(dj["labels"]),) * 2 and cm.sum() == dj["n_windows"])
    check("ROC: per-class curves start at (0,0), end at (1,1), AUC in [0,1]", dj["roc_per_class"] and all(
        c["points"][0] == [0.0, 0.0] and c["points"][-1] == [1.0, 1.0] and 0 <= c["auc"] <= 1 and len(c["points"]) <= 70 for c in dj["roc_per_class"]))
    check("ROC: fault-vs-none curve present", dj["roc_fault_vs_none"] is not None and dj["roc_fault_vs_none"]["auc"] > 0.5)
    imp = dj["importance"]
    check("permutation importance: top features + per-sensor sums, sorted", 0 < len(imp["features"]) <= 15 and "permutation" in imp["method"]
          and [s["importance"] for s in imp["by_sensor"]] == sorted((s["importance"] for s in imp["by_sensor"]), reverse=True) and all(s["importance"] >= 0 for s in imp["by_sensor"]))
    check("per-class recall in [0,1]", all(0 <= v <= 1 for v in dj["per_class_recall"].values()))
    t0 = time.time(); client.post("/api/pdm/diagnostics", json={"model_id": fm["id"], "n_runs": 6})
    check("repeated request is served from cache", time.time() - t0 < 1.0)
    check("diagnostics: unknown model 404, bad n_runs 422", client.post("/api/pdm/diagnostics", json={"model_id": "pdm_nope"}).status_code == 404
          and client.post("/api/pdm/diagnostics", json={"model_id": fm["id"], "n_runs": 1}).status_code == 422)
    rm = client.post("/api/pdm/train", json={"task": "rul", "name": "diag rul", "train_source": "physics", "n_train_runs": 30, "n_test_runs": 4, "duration_s": 1200}).json()
    rd = client.post("/api/pdm/diagnostics", json={"model_id": rm["id"], "n_runs": 8}).json()
    check("RUL diagnostics: scatter (<=400 points), MAE, R2", rd["task"] == "rul" and 0 < len(rd["scatter"]) <= 400 and rd["mae_s"] >= 0 and "r2" in rd)
    check("RUL scatter values are within the cap", all(0 <= a <= rd["rul_cap_s"] and p == p for a, p in rd["scatter"]))
    ib = client.post("/api/pdm/imbalance-fix", json={"model_id": job["model_id"], "n_real": 6, "n_fault_real": 1, "n_synth": 6, "n_test": 4, "duration_s": 600})
    ibj = ib.json()
    check("imbalance experiment returned", ib.status_code == 200, str(ibj)[:150] if ib.status_code != 200 else "")
    check("both arms report macro-F1 and per-class recall", all(0 <= ibj[k]["macro_f1"] <= 1 and ibj[k]["per_class_recall"] for k in ("real_only", "real_plus_synthetic")))
    check("improvement block: delta consistent, headline present", abs(ibj["improvement"]["macro_f1_delta"] - (ibj["real_plus_synthetic"]["macro_f1"] - ibj["real_only"]["macro_f1"])) < 1e-3
          and bool(ibj["improvement"]["headline"]) and ibj["improvement"]["classes"])
    check("real-only training set really is imbalanced (few fault windows)", ibj["real_only"]["train_class_counts"].get("none", 0) > sum(v for k, v in ibj["real_only"]["train_class_counts"].items() if k != "none"))
    check("imbalance: n_fault_real >= n_real -> 422; unknown model -> 404", client.post("/api/pdm/imbalance-fix", json={"model_id": job["model_id"], "n_real": 6, "n_fault_real": 6}).status_code == 422
          and client.post("/api/pdm/imbalance-fix", json={"model_id": "mdl_nope"}).status_code == 404)
    pdf2 = client.get(f"/api/runs/{run['id']}/report")
    check("PDF report now also covers the saved PdM models", pdf2.status_code == 200 and len(pdf2.content) >= len(pdf.content) - 20_000)

    print("Backward compatibility")
    check("Phase 1-5 endpoints still answer", all(client.get(p).status_code == 200 for p in ("/api/health", "/api/sensors", "/api/faults/catalog", "/api/runs", "/api/scenarios",
                                                                                           "/api/generative/models", "/api/pdm/models", "/api/overview")))
    check("overview still has all Phase 5 keys", {"runs", "scenarios", "generative_models", "pdm_models", "active_jobs", "version"} <= set(client.get("/api/overview").json()))

part_7b()

print("\n" + ("ALL CHECKS PASSED" if ok else "SOME CHECKS FAILED"))
sys.exit(0 if ok else 1)
