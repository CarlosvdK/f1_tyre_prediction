# F1 Tyre Strategy Prediction

Predicts the optimal pit stop strategy for any Formula 1 race — when to pit and which tyre compound to use — by combining a machine learning lap time model with exhaustive strategy search.

> **The complete model pipeline (data loading, cleaning, model comparison, evaluation, and strategy demo) can be found in [`final_model.ipynb`](final_model.ipynb).**

---

## How It Works

The system has two layers: an **ML model** that predicts lap times, and a **strategy engine** that uses those predictions to find the fastest race plan.

### 1. ML Model — Predict Lap Times

A **Gradient Boosting regressor** trained on ~93,000 real F1 laps (2019–2024) predicts how fast a driver will be on any given lap.

**Features:**
- Circuit (GP), Driver, Team, Compound (SOFT / MEDIUM / HARD)
- Tyre age (laps on current set)
- Race progress (% of race completed — captures fuel burn-off)
- Track position (dirty air effect)
- Stint number

**Target:** `LapTimePerKM` — lap time normalised by circuit length so the model generalises across tracks.

### 2. Strategy Engine — Find the Optimal Plan

For each race, the engine:

1. Gets the ML model's base pace prediction for the driver/team/circuit
2. Enumerates **~9,000 candidate strategies** (1-stop, 2-stop, 3-stop with every legal compound combination and pit lap)
3. For each strategy, sums up predicted lap times across all laps, adding:
   - Compound pace offsets (Soft is faster, Hard is slower)
   - Tyre degradation per lap (from real data curves)
   - Pit stop time penalty (per-circuit median from real data)
4. Picks the strategy with the **lowest total race time**

**Constraints enforced:**
- Must use at least 2 different compounds (FIA regulation)
- Each stint must be at least 5 laps
- Maximum 2 pit stops (limited by available tyre sets)

---

## Model Selection Process

We compared 6 regression models on a temporal holdout (train: 2019–2023, test: 2024 season):

| Model | MAE (s/km) | RMSE (s/km) | R² |
|-------|-----------|------------|-----|
| **Gradient Boosting** | **0.353** | **0.450** | **0.914** |
| Ridge Regression | 0.373 | 0.483 | 0.901 |
| Linear Regression | 0.373 | 0.484 | 0.901 |
| Random Forest | 0.406 | 0.509 | 0.890 |
| Decision Tree | 0.473 | 0.599 | 0.848 |
| AdaBoost | 0.925 | 1.081 | 0.505 |

**Why Gradient Boosting?** Lowest MAE across all models. MAE is the right metric here because the strategy optimizer sums predicted lap times over ~50–70 laps — small per-lap errors compound. A 0.01 s/km improvement saves ~3s over a full race, enough to change which strategy is optimal.

**Why not simpler models?**
- Linear/Ridge can't capture non-linear tyre degradation or compound × circuit interactions
- Decision Tree overfits to training data and generalises poorly to the unseen 2024 season
- AdaBoost converges poorly with our feature set (high-dimensional one-hot encoding)
- Random Forest is close but slightly less precise — it averages independent trees, while GB sequentially corrects errors

### Models We Tried But Dropped

We also trained 4 additional models for other components of the strategy pipeline. All were evaluated and intentionally removed:

| Model | Task | R² | Why dropped |
|-------|------|-----|-------------|
| PitstopT | Predict pit stop duration | 0.37 | With only GP as a feature, it's just a lookup table. Replaced by per-circuit median from ~4,000 real pit stops — same accuracy, simpler. |
| Inlap | Predict in-lap time | 0.51 | Double-counts time already captured in the pit cost average. |
| Outlap | Predict out-lap time | 0.15 | Too weak — out-lap times depend on traffic and tyre warming strategy, too noisy to predict. |
| Safety Car | Predict SC probability | 0.50 (AUC) | Coin flip. Crashes are random — no features beat chance. |

The final system uses **only the LapTimePerKM model**. Everything else is handled by real data lookups or physics-based calculations.

---

## Hardcoded Constants

Six constants are not learned by ML but sourced from real data or calibration:

| Constant | Value | Source | Why hardcoded |
|----------|-------|--------|---------------|
| **Compound pace offsets** | S: -0.85s, M: 0.0s, H: +0.55s | Pirelli technical data | Can't measure from race laps — fuel, dirty air, and position confound the comparison |
| **Degradation scale** | 2.5× | Calibrated via grid search over 87 races | Raw degradation data under-estimates wear due to fuel correction over-subtraction. 2.5× validated against real pit timing (MAE = 7.8 laps, bias = -3.2 laps) |
| **Pit stop cost** | Per-circuit median, fallback 23.5s | ~4,000 real pit stops (2019–2024) | Varies by pit lane length; direct lookup is more reliable than an ML model |
| **Min stint laps** | 5 | Operational constraint | Tyres need minimum laps to reach operating temperature |
| **Race tyre sets** | 3 | FIA allocation rules | ~13 sets per weekend, typically 3 usable sets remain for the race |
| **Expected tyre life** | S:14, M:18, H:26 | Median stint lengths from Stints.csv | Guides pit window search for 2/3-stop strategies |

The DEG_SCALE calibration script (`f1_strategy/scripts/calibrate_deg_scale.py`) validates the 2.5× factor by running the optimizer with every value from 1.0 to 5.0 and comparing predicted pit laps to where teams actually pitted across 87 real races.

---

## Data

All data is derived from official FIA timing data (2019–2024) via the [FastF1](https://github.com/theOehrly/Fast-F1) library.

| Dataset | Rows | Description |
|---------|------|-------------|
| `DryQuickLaps.csv` | 93,577 | Clean racing laps (dry weather, within 107% of fastest) |
| `Stints.csv` | 6,051 | Stint summaries per driver (compound + length) |
| `Pitstops.csv` | 4,020 | Pit stop durations |
| `DegradationCurves.csv` | 3,066 | Fuel-corrected tyre degradation per lap age |
| `CircuitInfo.csv` | 32 | Circuit characteristics (length, abrasion, tyre stress, etc.) |
| `Nlaps.csv` | 112 | Total race laps per GP per year |

**Data cleaning applied:**
- Wet races excluded (only dry compound data)
- 107% rule: laps slower than 107% of fastest are removed (safety cars, incidents)
- 1st/99th percentile outlier removal on LapTimePerKM
- Pit stops filtered to 10–60s (excludes penalties and red flag stops)
- Degradation curves: fuel correction at -0.06 s/lap, minimum 5-lap stints, minimum 3 samples per group

---

## Interactive UI

A React-based dashboard visualises predictions in real time:

- **Track map** — shows braking and throttle zones from real telemetry data, animated per lap to show tyre wear effects
- **Strategy comparison** — top 3 strategies with visual stint bars and time deltas
- **Degradation chart** — predicted lap times per lap for the optimal strategy
- **Lap slider** — scrub through the race to see how telemetry changes with tyre wear

### Running the UI

```bash
cd ui && npm install && npm run dev
```

The backend (strategy predictions):
```bash
cd f1_strategy && pip install -r requirements.txt
python -m uvicorn f1pit.server:app --reload
```

---

## Project Structure

```
f1_tyre_prediction/
├── final_model.ipynb                 # Complete model pipeline (start here)
├── requirements.txt                  # Python dependencies
├── data/
│   ├── processed/                    # Cleaned CSVs ready for modelling
│   └── CircuitInfo.csv               # Circuit characteristics
├── f1_strategy/
│   ├── f1pit/
│   │   ├── models/
│   │   │   ├── strategy_optimizer.py # Strategy enumeration + evaluation
│   │   │   ├── strategy_models.py    # Model training (RF vs GB)
│   │   │   └── unused_models.py      # Documentation of dropped models
│   │   ├── features/
│   │   │   └── strategy_features.py  # Feature engineering + train/test split
│   │   ├── data/
│   │   │   └── fetch_fastf1.py       # Data extraction from FastF1
│   │   └── server.py                 # FastAPI backend
│   ├── scripts/
│   │   ├── calibrate_deg_scale.py    # DEG_SCALE grid search validation
│   │   └── build_deg_curves.py       # Build degradation curves from lap data
│   └── artifacts/
│       └── strategy_latest/          # Trained model artifacts
└── ui/                               # React dashboard
    └── src/
        ├── App.tsx                    # Main application
        ├── components/
        │   ├── TrackMap.tsx           # Telemetry visualisation
        │   └── DegradationChart.tsx   # Strategy + lap time charts
        └── data/
            └── api.ts                # Data layer + telemetry processing
```

---

## Reproducing the Results

```bash
# 1. Set up environment
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 2. Run the notebook
jupyter notebook final_model.ipynb

# 3. (Optional) Retrain the model
cd f1_strategy
python f1pit/models/strategy_models.py

# 4. (Optional) Re-run DEG_SCALE calibration
python scripts/calibrate_deg_scale.py
```

All data files are included in the repository. No external API calls or downloads are needed.
