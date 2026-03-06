---
description: How to run the full F1 prediction pipeline end-to-end
---

# Full ML Pipeline

## Overview
End-to-end pipeline: FastF1 data extraction → model training → strategy optimization → API serving.

## Quick Start (complete pipeline)

### Option A: Make commands (step by step)
```bash
cd model

# Step 1: Extract data from FastF1 (30-60 min first time)
make fastf1-fetch

# Step 2: Train all 5 strategy models
make strategy-train

# Step 3: Test an optimization
make strategy-optimize

# Step 4: Start the API server
make serve
```

### Option B: End-to-end script
```bash
cd model
DATA_MODE=fastf1 YEARS="2019 2020 2021 2022 2023 2024" bash scripts/run_end_to_end.sh
```

### Option C: Original Kaggle pipeline (legacy)
```bash
cd model
DATA_MODE=demo bash scripts/run_end_to_end.sh
```

## Pipeline Stages

```
FastF1 API → fetch_fastf1.py → 8 CSVs → strategy_models.py → 5 .joblib models
                                                                      ↓
  UI ← Vite dev server ← FastAPI ← strategy_optimizer.py ← model artifacts
```

### Stage 1: Data Extraction
- **Script**: `model/f1pit/data/fetch_fastf1.py`
- **Input**: FastF1 API (internet required)
- **Output**: 8 CSV files in `data/processed/`

### Stage 2: Model Training
- **Script**: `model/f1pit/models/strategy_models.py`
- **Input**: CSVs from Stage 1 + `data/CircuitInfo.csv`
- **Output**: 5 `.joblib` model pipelines + `strategy_metrics.json`

### Stage 3: Strategy Optimization
- **Script**: `model/f1pit/models/strategy_optimizer.py`
- **Input**: Trained models + circuit/driver parameters
- **Output**: Ranked list of strategies with estimated race times

### Stage 4: API Serving
- **Script**: `model/f1pit/api/server.py`
- **Endpoints**:
  - `GET /api/strategy/optimal` – best strategy for a circuit
  - `GET /api/strategy/compare` – deterministic vs window
  - `GET /api/safety-car/probability` – SC probability per lap
  - `GET /api/predictions` – legacy pit window predictions
  - `GET /api/telemetry` – lap telemetry data

### Stage 5: Frontend
```bash
cd ui
npm install
npm run dev
```

## Testing
```bash
cd model
make test
# Expected: 10 tests pass
```

## Common Issues
1. **FastF1 rate limit** → Wait 5 min, retry. Data is cached.
2. **Missing CircuitInfo.csv** → Ensure `data/CircuitInfo.csv` exists.
3. **Import errors** → Check `PYTHONPATH=.` from `model/` directory.
4. **Models not found for API** → Run `make strategy-train` first.
