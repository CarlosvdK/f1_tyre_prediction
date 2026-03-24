# F1 Tyre Strategy Prediction
### Applying Supervised Machine Learning to Race Strategy Optimization
**AI II Final Project Report — Group 8**

> The complete reproducible model pipeline is available in [`final_model.ipynb`](final_model.ipynb).

---

## 1. Problem and Objective

Pit stop timing is one of the most consequential decisions in an F1 race. Tyre wear depends on compound, circuit, fuel load, and driving style — all interacting in ways that are difficult to reason about in real time. We built a system that predicts the optimal pit strategy (when to stop and on which tyres) for any driver at any circuit.

The initial approach trained five supervised learning models: lap pace, pit stop duration, in-lap time, out-lap time, and safety car probability. During integration, only **one ML model survived: LapTimePerKM**, a Gradient Boosting regressor predicting base lap pace. The other four were dropped — pit stop duration was replaced by a per-circuit average from real data, in-lap/out-lap predictions double-counted that average, and safety car prediction performed at coin-flip level (crashes are random).

The final optimizer combines this ML prediction with three data-driven components: (1) **tyre degradation curves** — non-linear, per-circuit wear profiles from 93,577 fuel-corrected laps, scaled by a calibrated factor of 2.5x; (2) **compound pace offsets** from Pirelli technical data (SOFT: -0.85 s/lap, HARD: +0.55 s/lap vs MEDIUM); and (3) **pit stop cost** — per-circuit median from ~4,000 real pit stops. The optimizer enumerates ~9,000 valid strategies (1-stop, 2-stop, 3-stop), sums predicted lap times and pit costs for each, and selects the lowest total race time.

## 2. Data

Four publicly available sources were used:

- **FastF1 (Python API):** Official FIA timing data — lap times, compounds, pit records — for 2019–2024.
- **Kaggle F1 Dataset:** Historical race results and constructor data for team/driver identifiers.
- **Ergast API:** Circuit metadata and coordinates, cached locally.
- **CircuitInfo.csv:** Pirelli tyre stress ratings per circuit (abrasion, traction, braking) for 32 circuits.

**Cleaning:** Wet-compound laps were excluded. The 107% rule removed safety car laps and outliers. Compounds were standardised to SOFT/MEDIUM/HARD. Pit stops were filtered to a 10–60s window (88.9% pass rate). LapTimePerKM outliers outside the 1st–99th percentile were removed.

**Final dataset:** 93,577 laps, 4,020 pit stops, 6,051 stints, 112 races, 34 GPs across 2019–2024.

## 3. Features and Validation

Features were chosen based on what is known *before* the lap is driven. Post-race outcomes were excluded to prevent leakage.

| Feature | Type | Role |
|---------|------|------|
| GP | Categorical | Circuit-specific pace |
| Driver | Categorical | Driver skill |
| Team | Categorical | Car performance |
| Compound | Categorical | Tyre type (S/M/H) |
| RacePercentage | Numeric | Fuel burn-off (cars get lighter → faster) |
| TyreLife | Numeric | Laps on current tyres (degradation) |
| Position | Numeric | Dirty air effect from cars ahead |
| Stint | Numeric | Which stint (1st, 2nd, 3rd) |

**Target:** LapTimePerKM (lap time / circuit length) — normalises across circuits of different lengths.

**Preprocessing:** Median imputation + StandardScaler (numeric); mode imputation + OneHotEncoder (categorical).

**Validation:** Temporal holdout — train on 2019–2023, test on 2024. This reflects real deployment: the model must generalise to a season it has never seen.

## 4. Model Selection and Evaluation

Six regression models were compared on the 2024 holdout, selected by lowest MAE:

**Table 1 — Model Comparison (2024 Holdout)**

| Model | MAE (s/km) | RMSE (s/km) | R² |
|-------|-----------|------------|-----|
| **Gradient Boosting** | **0.353** | **0.450** | **0.914** |
| Ridge Regression | 0.373 | 0.483 | 0.901 |
| Linear Regression | 0.373 | 0.484 | 0.901 |
| Random Forest | 0.406 | 0.509 | 0.890 |
| Decision Tree | 0.473 | 0.599 | 0.848 |
| AdaBoost | 0.925 | 1.081 | 0.505 |

**Gradient Boosting** was selected for lowest MAE. Linear and Ridge models cannot capture non-linear tyre degradation or compound-circuit interactions. Decision Tree overfits. AdaBoost converges poorly with high-dimensional one-hot features. Random Forest is close but GB's sequential error correction is more precise.

**Table 2 — Additional Models Trained and Dropped**

| Model | Task | R² / AUC | Why dropped |
|-------|------|----------|-------------|
| PitstopT | Pit stop duration | R² = 0.37 | Equivalent to a per-circuit lookup table — replaced by median from real data |
| Inlap | In-lap time | R² = 0.51 | Double-counts time already in pit cost average |
| Outlap | Out-lap time | R² = 0.15 | Too weak — out-lap times depend on traffic and tyre warming |
| Safety Car | SC probability | AUC = 0.50 | Coin flip — crashes are inherently unpredictable |

### How the Optimizer Uses the Model

The ML model is queried once per (driver, circuit) to get a MEDIUM-compound baseline pace. For each candidate strategy, the optimizer computes per-lap times by adding compound pace offsets (from Pirelli technical data), non-linear tyre degradation curves (fuel-corrected from real lap data, scaled by a calibrated factor validated against 87 real races), and per-circuit pit stop costs (median from ~4,000 real pit stops). It then enumerates ~9,000 valid strategies — all legal compound combinations across 1, 2, and 3-stop configurations — and selects the one with the lowest total race time.

## 5. Critical Reflection

**Compound pace offsets are the biggest assumption.** The 1.4 s/lap swing between SOFT and HARD cannot be independently verified from race data and may shift with regulation changes. Over a 70-lap race, a 10% error in these offsets shifts predicted race time by ~10s — enough to change which strategy ranks first.

**Simpler methods beat ML in 3 of 5 targets.** Pit cost was better served by a lookup table. Degradation came from domain-specific fuel correction rather than learned implicitly. Safety car prediction was impossible. This underscores that ML is not always the right tool — domain-informed averages outperform when signal is weak or features are thin.

**Distributional shift.** The 2022 ground-effect regulation change fundamentally altered tyre loading. Pre-2022 training data carries partially wrong priors, and the model requires retraining each season.

**Evaluation gap.** R² measures individual lap-time accuracy, but what matters is whether strategy *rankings* are correct. A dedicated metric comparing the optimizer's top strategy to actual race-winning strategies was not computed.

**Team data imbalance.** Top teams generate more clean laps; predictions for smaller teams are likely less reliable.

---

## Appendix — Reproducibility

```
pip install -r requirements.txt          # Install dependencies
jupyter notebook final_model.ipynb       # Run complete pipeline

cd f1_strategy
python f1pit/models/strategy_models.py   # Retrain models
python scripts/calibrate_deg_scale.py    # Re-run DEG_SCALE calibration
python scripts/build_deg_curves.py       # Rebuild degradation curves

cd ui && npm install && npm run dev      # Launch interactive dashboard
```

All data is included in `data/processed/`. Trained model artifacts: `f1_strategy/artifacts/strategy_latest/`. Unused model rationale: `f1_strategy/f1pit/models/unused_models.py`. No external API calls needed for reproduction.
