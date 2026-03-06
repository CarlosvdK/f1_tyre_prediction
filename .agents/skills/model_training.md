---
description: How to train the 5 strategy ML models (RF vs Gradient Boosting)
---

# Strategy Model Training

## Overview
Trains 5 separate ML models comparing **Random Forest** vs **Gradient Boosting**, auto-selecting the best for each:

| # | Model | Target | Task | Primary Metric |
|---|-------|--------|------|----------------|
| 1 | LapTimePerKM | Normalized lap time (s/km) | Regression | MAE |
| 2 | PitstopT | Pit stop duration (seconds) | Regression | MAE |
| 3 | Inlap | Inlap time per km | Regression | MAE |
| 4 | Outlap | Outlap time per km | Regression | MAE |
| 5 | SafetyCar | Safety car probability | Classification | ROC AUC |

## Prerequisites
- Data extraction completed (8 CSV files in `data/processed/`)
- Working directory: `model/`

## Steps

### 1. Train all models
```bash
cd model
make strategy-train

# Or with custom years:
PYTHONPATH=. python -m f1pit.models.strategy_models \
  --data_dir ../data/processed \
  --train_years 2019 2020 2021 2022 2023 \
  --test_years 2024
```

### 2. Check output artifacts
After training, `model/artifacts/strategy_<timestamp>/` contains:
- `lap_time_model.joblib` – best lap time model pipeline
- `pitstop_model.joblib` – best pit stop model pipeline
- `inlap_model.joblib` – best inlap model pipeline
- `outlap_model.joblib` – best outlap model pipeline
- `safety_car_model.joblib` – best safety car model pipeline
- `strategy_metrics.json` – all model metrics

A symlink `model/artifacts/strategy_latest` → latest run.

### 3. Verify model quality
Check `strategy_metrics.json`:
```python
import json
with open("artifacts/strategy_latest/strategy_metrics.json") as f:
    metrics = json.load(f)
for name, m in metrics["models"].items():
    print(f"{name}: {m}")
```

**Expected ranges:**
- LapTimePerKM MAE: < 1.0 s/km
- PitstopT MAE: < 3.0 seconds
- Inlap MAE: < 2.0 s/km
- Outlap MAE: < 2.0 s/km
- SafetyCar ROC AUC: > 0.6

## Model Architecture Details

### Feature Engineering (`strategy_features.py`)
- **LapTimePerKM** = LapTime / CircuitLength (normalizes across tracks)
- **RacePercentage** = LapNumber / TotalLaps (0.0 → 1.0)
- **TyreLife** = laps on current set of tyres
- Categorical features are one-hot encoded, numeric features are standardized

### Model Selection Logic
For each model, both RF and GB are trained on 2019-2023 data and compared on 2024. The winner is then retrained on ALL data (2019-2024) for production use.

### Hyperparameters (defaults)
**Random Forest**: n_estimators=300, max_depth=15, min_samples_leaf=5
**Gradient Boosting**: n_estimators=300, learning_rate=0.05, max_depth=5, subsample=0.8

## Troubleshooting
- **"LapTimePerKM not computed"**: CircuitInfo.csv is missing `Length` column for some GPs.
- **Low R² on lap time model**: Check for outliers in DryQuickLaps.csv. Remove pit laps and safety car laps.
- **Imbalanced safety car model**: This is expected (SC events are rare). The model uses `class_weight="balanced_subsample"`.
