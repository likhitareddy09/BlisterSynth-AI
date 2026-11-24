
"""FastAPI entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .api import copilot, datasets, faults, generative, overview, pdm, simulate, stream
from .config import APP_NAME, APP_VERSION, CORS_ORIGINS, FRONTEND_DIST
from .database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    lifespan=lifespan,
    description="Synthetic pharma blister-packaging-line sensor data generator with fault injection, ground-truth labels and learned generators (cVAE, TimeGAN), fidelity metrics, PdM models and a React dashboard (frontend/).",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(simulate.router)
app.include_router(faults.router)
app.include_router(stream.router)
app.include_router(generative.router)
app.include_router(pdm.router)
app.include_router(pdm.quality_router)
app.include_router(overview.router)
app.include_router(datasets.router)
app.include_router(copilot.router)


@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok", "app": APP_NAME, "version": APP_VERSION}


# Serve React's built frontend at the root URL.
if FRONTEND_DIST.is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_DIST / "assets"),
        name="assets",
    )

    @app.get("/", include_in_schema=False)
    def frontend():
        return FileResponse(FRONTEND_DIST / "index.html")

else:
    @app.get("/", tags=["meta"])
    def root():
        return {"app": APP_NAME, "docs": "/docs", "health": "/api/health"}
