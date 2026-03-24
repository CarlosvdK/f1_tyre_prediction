F1 Tyre Strategy Prediction

Applying Supervised Machine Learning to Race Strategy Optimization

AI II Final Project Report: Group 8

## 1. Problem and Objective

When to pit is one of the most consequential decisions in an F1 race. Get the timing right, and you gain track position; get it wrong, and the race is effectively over. The difficulty is that tyre wear depends on compound, circuit, fuel load, driving style, and on-track events — all interacting in ways that are hard to reason about in real time.

The initial approach decomposed the problem into five supervised learning targets: lap pace, pit stop duration, in-lap time, out-lap time, and safety car probability. All five were trained and evaluated (Table 1), but during integration only **one ML model survived: LapTimePerKM**, a Gradient Boosting regressor that predicts base lap pace for a given driver, team, and circuit. The other four were dropped — pit stop duration was replaced by a simple per-circuit average from real data, in-lap and out-lap effects were already captured in that average (using them separately would double-count), and safety car prediction performed at chance level since crashes are inherently random.

The final strategy optimizer combines this single ML prediction with three data-driven components:

- **Tyre degradation rates** — per-circuit, per-compound wear rates (s/lap) computed from fuel-corrected analysis of 91,955 real laps across 34 circuits
- **Compound pace offsets** — how much faster softs are vs hards (-0.85s/lap for SOFT, +0.55s/lap for HARD vs MEDIUM), from Pirelli technical data
- **Pit stop cost** — per-circuit median time lost during a stop, from ~4,000 real pit stops

The optimizer enumerates every valid pit configuration (≥2 tyre compounds, ≤3 stops, ≥5 laps per stint), sums predicted lap times and pit costs for each, and ranks them by total race time — producing a ranked list of 1-stop, 2-stop, and 3-stop options for any circuit and driver.

## 2. Dataset Identification

Four data sources were used, all publicly available:

- **FastF1 (Python API):** Official F1 telemetry (lap times, tyre compound, pit stop records) for 2019–2024.
- **Kaggle F1 Dataset (1950–2024):** Historical race results and constructor data for team and driver identifiers.
- **Ergast/Jolpica API:** Circuit metadata (coordinates, race schedules), cached locally to avoid rate limits.
- **CircuitInfo.csv:** Hand-compiled Pirelli tyre stress ratings per circuit (abrasion, traction, braking, lateral load, asphalt age) for 32+ circuits.

Wet-compound laps (INTERMEDIATE/WET) were dropped to focus on dry-race degradation. The 107% rule removed formation laps and outliers. Compounds were standardized to SOFT, MEDIUM, and HARD. Pit stop records were validated against a 10–60 second service window (92.8% pass rate). Final dataset: 93,577 laps, 4,020 pit stops, 6,052 stints, 111 races, 34 circuits across 2019–2024.

## 3. Feature Engineering and Validation Strategy

Features were chosen based on what would plausibly be known at the time of the decision. Post-race outcomes and whole-stint aggregates derived from future laps were excluded to prevent leakage.

The LapTimePerKM model uses eight features: RacePercentage, TyreLife, Position, and Stint (numeric); GP, Driver, Team, and Compound (categorical). RacePercentage captures fuel burn-off — cars get lighter and faster as the race progresses — so no separate fuel correction is needed. TyreLife captures how many laps the current set of tyres has done. The model predicts lap time per kilometre rather than raw lap time, normalizing across circuits of different lengths. The preprocessing pipeline uses median imputation + StandardScaler for numeric features and mode imputation + OneHotEncoder for categorical features (scikit-learn Pipeline).

Validation used a temporal holdout: 2019–2023 for training, 2024 as a held-out test season. This reflects real deployment conditions — the model must generalize to a future season it was never trained on.

## 4. Model Implementation and Evaluation

For each of the five original targets, both Random Forest and Gradient Boosting (scikit-learn) were trained on the same pipeline, and the better algorithm was auto-selected by the primary metric: R² for regressions, ROC-AUC for classification. Results on the 2024 holdout are shown in Table 1.

**Table 1 — Model Performance on 2024 Holdout Test Set**

| Model | Task | Algorithm | R² / ROC-AUC | MAE / F1 | Used in Optimizer |
|---|---|---|---|---|---|
| LapTimePerKM | Regression | Gradient Boosting | R² = 0.913 | MAE = 0.356 s/km | Yes |
| PitstopT | Regression | Random Forest | R² = 0.373 | MAE = 2.08 s | No — replaced by per-circuit average |
| Inlap | Regression | Gradient Boosting | R² = 0.505 | MAE = 1.48 s | No — double-counts pit cost |
| Outlap | Regression | Gradient Boosting | R² = 0.151 | MAE = 1.44 s | No — double-counts pit cost |
| SafetyCar | Classification | Gradient Boosting | ROC-AUC = 0.499 | F1 = 0.00 | No — performs at chance level |

**LapTimePerKM** (R² = 0.913, MAE = 0.356 s/km) is the only model used in the final optimizer. It predicts one value: the base lap pace for a given driver at a given circuit. Gradient Boosting was selected over Random Forest because it achieved a lower MAE on the 2024 holdout. R² = 0.913 means the model explains 91.3% of the variance in lap pace, which is strong given that lap times are influenced by many factors not in the feature set (dirty air, battery deployment, track evolution). The remaining four models were trained but dropped for the reasons noted in the table.

**How the optimizer uses LapTimePerKM.** The model is queried once per (driver, circuit) combination to get a MEDIUM-compound baseline lap time. The optimizer then applies three adjustments per lap:

1. **Compound pace offset:** SOFT is 0.85s/lap faster than MEDIUM; HARD is 0.55s/lap slower. These offsets come from Pirelli technical data, not from the training data, because compound choice in race data is confounded with fuel load — hard tyres are run late when cars are light, making them appear artificially fast.

2. **Tyre degradation:** Each additional lap on a set of tyres adds a circuit-specific, compound-specific penalty (e.g., 0.114 s/lap for SOFT at Bahrain, 0.026 s/lap for SOFT at Silverstone). These rates are computed offline from real stint data: the fuel benefit (~0.06 s/lap from weight reduction) is added back to the raw lap time increase to isolate true tyre wear. This produces 99 (circuit, compound) rates across 34 circuits, stored in DegradationRates.csv.

3. **Pit stop cost:** The median time lost per pit stop at each circuit, computed from ~4,000 real pit stops (filtered to 10–60s). For circuits without data, the system falls back to the overall median of 23.5s.

The optimizer sums these per-lap times across all laps and all stints, adds pit costs, and compares every legal strategy. For a typical 1-stop race, this means testing ~280 strategies (6 compound pairs × ~47 possible pit laps); for 2-stop races, thousands of combinations are evaluated.

## 5. Critical Reflection

**Compound pace offsets are the biggest assumption.** The -0.85s / +0.55s offsets from Pirelli data cannot be independently verified and may not hold across regulation changes. The 1.4s/lap swing between SOFT and HARD has outsized leverage: over a 70-lap race, a 10% error shifts predicted race time by ~10s, enough to change which strategy ranks first. Deriving these offsets from race data was attempted but failed due to the fuel-load confound described above.

**Simpler methods beat ML in three out of five targets.** PitstopT's single-feature Random Forest was equivalent to a per-circuit average. The degradation pipeline's fuel-corrected stint analysis was more physically grounded than letting the ML model learn wear implicitly. SafetyCar prediction was fundamentally impossible. This highlights that supervised learning is not always the right tool — domain-informed averages can outperform ML when the signal is weak or the feature set is thin.

**Distributional shift.** The 2022 regulation change (ground-effect aerodynamics) fundamentally changed tyre loading. Training data from 2019–2021 carries partially wrong priors for 2022+ degradation. The temporal holdout is realistic about this, but it also means the model needs retraining each season as technical regulations evolve.

**Evaluation gap.** R² measures how well the model explains variance in individual lap times, but what matters for strategy is whether the *ordering* of strategies is correct. A model with R² = 0.913 could still rank two close strategies incorrectly. A more operationally meaningful metric would be comparing the optimizer's top-ranked strategy against the strategy that actually won each 2024 race, which was not evaluated here.

**Data imbalance across teams.** Top teams (Red Bull, Mercedes, Ferrari) generate far more laps of clean data than midfield or backmarker teams. Predictions are likely less reliable for smaller teams.

**Practical deployment gap.** The system is an offline batch predictor that assumes a fixed race length and does not react to live conditions (weather, safety cars, tyre temperature). Bridging this gap would require live telemetry ingestion and confidence intervals rather than point estimates.

## Appendix — Reproducibility

Retrain models: `cd f1_strategy && make strategy-train` | Serve API: `make serve` | Frontend: `cd ui && npm install && npm run dev`

Per-circuit degradation rates: `cd f1_strategy && python scripts/build_deg_table.py` (writes `data/processed/DegradationRates.csv`)

Unused model rationale: `f1_strategy/f1pit/models/unused_models.py`

Artifacts (trained models + evaluation metrics): `f1_strategy/artifacts/strategy_20260307_151844/`

All cleaned CSVs in `data/`; FastF1 requires `fastf1` Python package; Kaggle data requires Kaggle API credentials.
