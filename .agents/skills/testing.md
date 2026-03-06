---
description: How to run tests and validate the ML pipeline
---

# Testing & Validation

## Overview
Test suite covering feature engineering, model logic, strategy enumeration, and data integrity.

## Running Tests

### All tests
```bash
cd f1_strategy
make test
# Or:
PYTHONPATH=. python -m pytest tests/ -q
```

### Specific test files
```bash
# Strategy model tests (features + optimizer)
PYTHONPATH=. python -m pytest tests/test_strategy_models.py -v

# Original smoke tests (legacy pipeline)
PYTHONPATH=. python -m pytest tests/test_smoke.py -v
```

## Test Coverage

### `test_strategy_models.py` (9 tests)
| Test | What it validates |
|------|-------------------|
| `test_lap_time_per_km_computed` | LapTimePerKM = LapTime / Length |
| `test_race_percentage_computed` | RacePercentage = LapNumber / TotalLaps |
| `test_outlier_removal` | Extreme lap times are filtered out |
| `test_pitstop_data_filtering` | Pitstops outside 10-60s range removed |
| `test_safety_car_binary_target` | SC target is 0/1, correct for known events |
| `test_train_test_split_temporal` | Train = 2022-2023, Test = 2024 (no leakage) |
| `test_strategy_enumeration_minimum` | All strategies use ≥2 compounds |
| `test_strategy_stint_lengths_valid` | Every stint ≥ 5 laps |
| `test_format_time` | Time formatting (seconds → H:MM:SS.mmm) |

### `test_smoke.py` (1 test)
| Test | What it validates |
|------|-------------------|
| `test_feature_pipeline` | Legacy feature engineering pipeline runs without errors |

## Data Validation

### After data extraction
```python
import pandas as pd

# Check all 8 files exist and have data
files = ["DryQuickLaps.csv", "Stints.csv", "Strategyfull.csv", "Inlaps.csv",
         "Outlaps.csv", "PitstopsWithTeams.csv", "SafetyCars.csv", "NLaps.csv"]
for f in files:
    df = pd.read_csv(f"../data/processed/{f}")
    print(f"{f}: {len(df)} rows, {list(df.columns)[:5]}")
    assert len(df) > 0, f"{f} is empty!"
```

### After model training
```python
import json
with open("artifacts/strategy_latest/strategy_metrics.json") as f:
    m = json.load(f)

# Verify all 5 models trained
assert len(m["models"]) == 5
for name, metrics in m["models"].items():
    if metrics["task"] == "regression":
        assert metrics["mae"] < 5.0, f"{name} MAE too high"
    else:
        assert metrics["roc_auc"] > 0.5, f"{name} ROC AUC too low"
```

### API smoke test
```bash
# Start server first: cd f1_strategy && make serve
curl "http://localhost:8000/api/health"
curl "http://localhost:8000/api/strategy/optimal?track=Bahrain&total_laps=57"
curl "http://localhost:8000/api/safety-car/probability?track=Bahrain&total_laps=57"
```

## Adding New Tests
Place new test files in `f1_strategy/tests/`. Follow the naming convention `test_*.py`. Use the synthetic data generators in `test_strategy_models.py` as templates.
