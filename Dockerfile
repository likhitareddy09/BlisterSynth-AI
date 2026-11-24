# BlisterSynth AI - one container: FastAPI backend + built React app (served at /app/).
#   docker build -t blistersynth .
#   docker run -p 8000:8000 -v blistersynth-data:/data --env-file backend/.env blistersynth
# Then open http://localhost:8000/app/

# ---------- stage 1: build the React frontend ----------
FROM node:20-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- stage 2: Python runtime ----------
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BLISTERSYNTH_DATA_DIR=/data \
    PORT=8000
WORKDIR /app

# CPU-only PyTorch first (the default wheel pulls ~2 GB of CUDA libraries we don't need)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY --from=frontend /src/frontend/dist frontend/dist

VOLUME ["/data"]
EXPOSE 8000
WORKDIR /app/backend
# ONE worker on purpose: training jobs live in memory, and SQLite prefers a single writer.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
