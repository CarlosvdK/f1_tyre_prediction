# F1 Tyre Degradation Prediction Dashboard

## Run (Quick Start)

```bash
npm install
npm run prepare:model
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`).

## 3D Model Placement

Place your extracted asset pack here:

```text
public/models/redbull-rb19-oracle-wwwvecarzcom/
  source/
  texture/
```

- Put the main model file in `source/` (`.glb`, `.gltf`, `.fbx`, or `.obj`).
- Put texture images in `texture/`.
- If OBJ uses an `.mtl`, keep that `.mtl` in `source/`.

Then run:

```bash
npm run prepare:model
```

This runs [`scripts/generate_manifest.mjs`](scripts/generate_manifest.mjs), which scans `source/`, picks the first model in this priority:

1. `.glb`
2. `.gltf`
3. `.fbx`
4. `.obj`

and writes `public/models/model_manifest.json` used by the dashboard at runtime.

## Stack

- React + TypeScript + Vite
- Three.js via `@react-three/fiber` + `@react-three/drei`
- Plotly via `react-plotly.js` + `plotly.js-basic-dist`

## Implemented Features

- Top controls for driver, track, tyre compound, conditions, heatmap feature, lap slider, and light/dark mode.
- KPI panel with:
  - predicted lap time increase per lap
  - optimum pit window range
  - predicted tyre life remaining
- Center 3D viewer with orbit controls.
- Bottom 2D track map from XY traces + feature delta heat overlay.
- Theme persistence in `localStorage` and synchronized UI + Three.js lighting presets.

## Tyre Recoloring + Wear (Demo Logic)

Tyre meshes/materials are detected by name heuristics:

- `tire`, `tyre`, `wheel`, `pirelli`, `sidewall`, `stripe`, `rim`

Compound colors:

- soft = red
- medium = yellow
- hard = white
- inter = green
- wet = blue

Behavior:

- If stripe/logo appears as separate material, only that material is recolored.
- If not separable, the entire detected tyre mesh material is recolored (fallback).
- Wear effect (`0..1`) increases roughness and darkens rubber.
- Hover uses raycasting, scales tyre to `1.15x`, and displays wear tooltip.

Limitations:

- No custom shader noise overlay is applied in this version.
- Detection is heuristic-based and depends on mesh/material naming in your model.

## Track Map Computation

- Track outline is rendered from `tracks.json` XY polylines.
- Lap telemetry points are rendered as a colored overlay.
- Feature deltas are computed point-by-point versus a baseline lap telemetry trace:
  - braking earlier delta
  - lower corner speed delta
  - throttle delay delta
  - degradation intensity proxy

## Data Layout

Mock data lives in `src/data/mock/`:

- `tracks.json`
- `telemetry_monza.json`
- `telemetry_silverstone.json`
- `predictions.json`

Data access layer: `src/data/api.ts`

- `listTracks()`
- `listDrivers(track)`
- `listLaps(track, driver)`
- `getTelemetry(track, driver, lap)`
- `getPredictions(track, driver, lap, compound, conditions)`

## Backend Mode

Set:

```bash
VITE_USE_BACKEND=true
```

When enabled, `src/data/api.ts` switches from local JSON to HTTP fetch calls under `/api/...`.

This means you can plug real OpenF1/FastF1 telemetry and ML prediction services behind:

- `/api/tracks`
- `/api/drivers?track=...`
- `/api/laps?track=...&driver=...`
- `/api/telemetry?track=...&driver=...&lap=...`
- `/api/predictions?track=...&driver=...&lap=...&compound=...&conditions=...`

without changing UI components.

## Important Files

- `src/App.tsx`
- `src/components/ControlsBar.tsx`
- `src/components/KpiPanel.tsx`
- `src/components/CarViewer.tsx`
- `src/components/TrackMap.tsx`
- `src/components/Tooltip.tsx`
- `src/components/DebugPanel.tsx`
- `src/three/modelLoader.ts`
- `src/three/tireStyling.ts`
- `src/three/raycastHover.ts`
- `src/data/api.ts`
- `scripts/generate_manifest.mjs`
