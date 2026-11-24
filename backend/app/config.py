"""Central settings for the backend. Every path and limit lives here."""
from __future__ import annotations

import os
from pathlib import Path

APP_NAME = "BlisterSynth AI"
APP_VERSION = "0.7.0"

# backend/ folder (this file is backend/app/config.py)
BASE_DIR = Path(__file__).resolve().parent.parent

# Load backend/.env (ANTHROPIC_API_KEY, ANTHROPIC_MODEL, CORS_ORIGINS, ...) if it exists.
# Real environment variables always win over the file. python-dotenv ships with uvicorn[standard].
try:
    from dotenv import load_dotenv
    load_dotenv(BASE_DIR / ".env", override=False)
except ImportError:  # pragma: no cover - the app still runs, it just ignores .env
    pass

DATA_DIR = Path(os.getenv("BLISTERSYNTH_DATA_DIR", BASE_DIR / "data"))
RUNS_DIR = DATA_DIR / "runs"          # generated CSVs
UPLOADS_DIR = DATA_DIR / "uploads"    # user seed CSVs (Phase 7)
MODELS_DIR = DATA_DIR / "models"      # trained generative / PdM models (Phases 3-4)
REPORTS_DIR = DATA_DIR / "reports"    # PDF reports (Phase 7)
FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"   # built React app (Phase 5), served at /app if it exists
DB_PATH = DATA_DIR / "blistersynth.db"

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
]

# Safety limits so a typo can't freeze the laptop during a demo
MAX_DURATION_S = 48 * 3600       # 48 hours of data per run
MAX_SAMPLE_RATE_HZ = 10.0
MAX_ROWS = 600_000
PREVIEW_POINTS = 600             # points sent to the browser for charts
MAX_UPLOAD_MB = 25               # Data Lab CSV upload limit

# Scenario Copilot (Phase 7B). The API key itself is read from the ANTHROPIC_API_KEY environment variable
# at call time and is never stored, logged or returned.
COPILOT_DEFAULT_MODEL = "claude-sonnet-5-5"   # override with ANTHROPIC_MODEL
COPILOT_MAX_PROMPT_CHARS = 1000
COPILOT_TIMEOUT_S = 30.0


def ensure_dirs() -> None:
    for d in (DATA_DIR, RUNS_DIR, UPLOADS_DIR, MODELS_DIR, REPORTS_DIR):
        d.mkdir(parents=True, exist_ok=True)
