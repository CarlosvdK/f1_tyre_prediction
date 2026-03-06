---
description: How to start the FastAPI backend and Vite frontend
---

# Deployment / Running the App

## Overview
The application has two servers:
1. **Backend**: FastAPI Python server (port 8000) — serves ML predictions and strategy data
2. **Frontend**: Vite React dev server (port 5173) — 3D dashboard UI

## Quick Start

### Terminal 1: Backend API
```bash
cd model
make serve
# Or: PYTHONPATH=. uvicorn f1pit.api.server:app --host 127.0.0.1 --port 8000
```

### Terminal 2: Frontend UI
```bash
cd ui
npm install  # First time only
npm run dev
# Opens at http://localhost:5173
```

The Vite dev server proxies `/api/*` requests to the backend at `http://127.0.0.1:8000`.

## Prerequisites

### Backend
- Python 3.10+ with dependencies: `pip install -r model/requirements.txt`
- Trained models in `model/artifacts/latest/` (legacy) or `model/artifacts/strategy_latest/` (strategy)
- Processed data in `data/processed/` (lap_level.parquet for legacy, CSVs for strategy)

### Frontend
- Node.js 18+ with npm
- Dependencies: `cd ui && npm install`

## API Endpoints

### Legacy (pit window prediction)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/tracks` | GET | List available tracks |
| `/api/drivers?track=ID` | GET | Drivers for a track |
| `/api/laps?track=ID&driver=CODE` | GET | Available laps |
| `/api/telemetry?track=ID&driver=CODE&lap=N` | GET | Telemetry profile |
| `/api/predictions?track=ID&driver=CODE&lap=N` | GET | Pit window prediction |

### Strategy (new)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/strategy/optimal?track=GP&total_laps=N` | GET | Optimal strategy |
| `/api/strategy/compare?track=GP&total_laps=N` | GET | Compare det. vs window |
| `/api/safety-car/probability?track=GP&total_laps=N` | GET | SC probability per lap |

## Environment Variables
- `VITE_BACKEND_URL` — override backend URL (default: `http://127.0.0.1:8000`)

## Production Build
```bash
cd ui
npm run build   # Output in ui/dist/
npm run preview # Preview production build
```

## Troubleshooting
- **CORS errors**: Backend has `allow_origins=["*"]` — should work for local dev.
- **502 proxy error**: Backend not running. Start it first.
- **"Model not found"**: Run model training: `cd model && make strategy-train`
- **3D model not loading**: Ensure `ui/public/models/` contains the car `.glb` file.
