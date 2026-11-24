"""WebSocket live stream: ws://localhost:8000/ws/stream

Protocol (JSON messages)
  server -> client  {"type": "hello", "sensors": [...], "stations": [...], "config": {...}}
  server -> client  {"type": "tick", "rows": [ {...row..., "health": {...}, "status": {...}} ]}
  client -> server  {"action": "pause"} | {"action": "resume"} | {"action": "speed", "value": 10}
                    | {"action": "reset", "config": {...optional SimConfig fields...},
                       "faults": [...optional fault specs, onset_s in stream seconds...]}
                    | {"action": "inject", "fault": {"type": "bearing_wear", "profile": "gradual",
                       "ramp_s": 600, "intensity": 1.0}, "delay_s": 0}   # starts "now" (+ delay)
                    | {"action": "repair"}                                # clears every fault from "now"

`speed` is the playback multiplier: 1 = real time (1 sample/s at 1 Hz), 10 = ten
samples per second, etc. At high speeds several rows are bundled per message.

Every row also carries the ground-truth labels (fault_active, fault_type, fault_station,
fault_profile, fault_severity, fault_count, rul_s). Errors are reported as
{"type": "error", "message": "..."} and never close the socket.
"""
from __future__ import annotations

import asyncio
import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from ..schemas import FaultSpecIn
from ..simulator import (SENSORS, STATIONS, FaultInjector, LineSimulator, SimConfig, catalog,
                         health_status)

router = APIRouter(tags=["stream"])

MIN_FRAME_S = 0.05    # never send more than 20 messages per second
MAX_SPEED = 200.0


def _make_sim(overrides: dict | None, faults: list[dict] | None = None) -> tuple[LineSimulator, FaultInjector]:
    base = {"include_shutdown": False, "seed": None}
    cfg = SimConfig.from_dict(base | (overrides or {}))
    specs = [FaultSpecIn(**f).model_dump() for f in (faults or [])]      # validates, raises on bad input
    injector = FaultInjector(specs, None)                               # always attached, so inject works
    return LineSimulator(cfg, modifiers=[injector], streaming=True), injector


def _rows(data, health) -> list[dict]:
    rows = json.loads(data.to_json(orient="records"))
    hs = health.to_dict(orient="records")
    for r, h in zip(rows, hs):
        r["health"] = h
        r["status"] = {k: health_status(v) for k, v in h.items()}
    return rows


@router.websocket("/ws/stream")
async def stream(ws: WebSocket):
    await ws.accept()
    sim, injector = _make_sim(None)
    speed, paused = 1.0, False
    buffer: list[dict] = []
    await ws.send_json({"type": "hello", "sensors": [s.to_dict() for s in SENSORS],
                        "stations": STATIONS, "faults": catalog(),
                        "config": sim.cfg.to_dict() | {"seed": sim.seed}})
    try:
        while True:
            frame = max(MIN_FRAME_S, 1.0 / (speed * sim.cfg.sample_rate_hz))
            started = time.perf_counter()
            # Listen for control messages, but only until the next frame is due.
            try:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=frame)
                action = msg.get("action")
                extra: dict = {}
                try:
                    if action == "pause":
                        paused = True
                    elif action == "resume":
                        paused = False
                    elif action == "speed":
                        speed = float(min(MAX_SPEED, max(0.1, float(msg.get("value", 1)))))
                    elif action == "reset":
                        sim, injector = _make_sim(msg.get("config"), msg.get("faults"))
                        buffer = []
                        await ws.send_json({"type": "reset", "config": sim.cfg.to_dict() | {"seed": sim.seed},
                                            "faults": injector.to_dicts()})
                    elif action == "inject":
                        spec = FaultSpecIn(**(msg.get("fault") or {})).model_dump()
                        spec["end_s"] = None                                   # use "repair" to clear faults
                        delay = max(0.0, float(msg.get("delay_s", 0.0)))
                        extra["fault"] = injector.add(spec, onset_s=sim.time_s + delay)
                    elif action == "repair":
                        extra["repaired"] = injector.repair(sim.time_s)
                    await ws.send_json({"type": "ack", "action": action, "speed": speed,
                                        "paused": paused, **extra})
                except (ValidationError, ValueError, TypeError) as e:
                    await ws.send_json({"type": "error", "action": action, "message": str(e)[:300]})
                # Wait out the rest of this frame so control messages don't speed up playback.
                remaining = frame - (time.perf_counter() - started)
                if remaining > 0:
                    await asyncio.sleep(remaining)
            except asyncio.TimeoutError:
                pass

            if paused:
                continue
            per_frame = max(1, round(speed * sim.cfg.sample_rate_hz * frame))
            while len(buffer) < per_frame:
                # Generate only what this frame needs, so an injected fault shows up immediately.
                data, health = await asyncio.to_thread(sim.generate, per_frame - len(buffer))
                buffer.extend(_rows(data, health))
            out, buffer = buffer[:per_frame], buffer[per_frame:]
            await ws.send_json({"type": "tick", "rows": out})
    except WebSocketDisconnect:
        return
