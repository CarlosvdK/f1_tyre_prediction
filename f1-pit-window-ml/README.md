# F1 Tyre Degradation Prediction Dashboard

## Run (Real Model + Real Data)

Terminal 1 (backend API):

```bash
python -m pip install -r requirements.txt
PYTHONPATH=src uvicorn f1pit.api.server:app --host 127.0.0.1 --port 8000
```

Terminal 2 (frontend):

```bash
npm install
npm run prepare:model
npm run dev
```

Open: `http://127.0.0.1:5173/`

## 3D Model Placement

Place your extracted RB19 files under:

```text
public/models/redbull-rb19-oracle-wwwvecarzcom/
  source/
  texture/
```

- Main mesh goes in `source/` (`.glb`, `.gltf`, `.fbx`, or `.obj`).
- Texture images go in `texture/`.
- If using OBJ, keep `.mtl` in `source/`.

Then run:

```bash
npm run prepare:model
```

This writes `public/models/model_manifest.json` with automatic format detection priority:
1. `.glb`
2. `.gltf`
3. `.fbx`
4. `.obj`

If no model is found, a placeholder manifest is written so the UI can still run.

## What Is Now Real vs Mock

Real:
- 3D car model loading from your RB19 asset path.
- Trained ML model inference from `artifacts/latest/model.joblib`.
- Track list, driver list, and lap list from latest season in `data/processed/lap_level.parquet`.

Generated (from real race/lap data statistics):
- Dense telemetry points (`x,y,speed,brake,throttle`) used by track heatmap.
- Track outlines are high-resolution procedural curves keyed by real track/circuit IDs.

Why this is necessary: your dataset does not contain raw per-sample XY telemetry, so the backend synthesizes dense point clouds from multiple races per track to avoid sparse/straight-line maps.

## Backend API

Implemented in `src/f1pit/api/server.py`:

- `GET /api/health`
- `GET /api/tracks`
- `GET /api/drivers?track=...`
- `GET /api/laps?track=...&driver=...`
- `GET /api/telemetry?track=...&driver=...&lap=...`
- `GET /api/predictions?track=...&driver=...&lap=...&compound=...&conditions=...`

Frontend data layer (`src/data/api.ts`) uses backend mode by default.
Set `VITE_USE_BACKEND=false` only if you want to force local mock JSON.

## Tyre Compound + Wear

Tyre meshes are detected by name heuristics (`tire/tyre/wheel/pirelli/sidewall/stripe/rim`), then:
- recolored by selected compound
- roughness increased with wear
- rubber darkened with wear
- hover raycast enlarges tyre and shows wear tooltip

## Key Files

- `src/f1pit/api/server.py` (real data + model-backed API)
- `src/data/api.ts` (frontend API adapter)
- `src/components/CarViewer.tsx`
- `src/components/TrackMap.tsx`
- `src/three/modelLoader.ts`
- `src/three/tireStyling.ts`
- `scripts/generate_manifest.mjs`
