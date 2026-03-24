F1 Tyre Strategy Prediction

Applying Supervised Machine Learning to Race Strategy Optimization

AI II Final Project Report: Group 8

## 1. Problem and Objective

When to pit is one of the most consequential decisions in an F1 race. Get the timing right, and you gain track position; get it wrong, and the race is effectively over. The difficulty is that tyre wear depends on compound, circuit, fuel load, driving style, and on-track events; all interacting in ways that are hard to reason about in real time.

Rather than predicting a single pit lap, the problem was decomposed into five supervised learning targets that together allow total race time to be estimated for any given pit strategy:

- **LapTimePerKM** — normalized lap pace (s/km) across a stint
- **PitstopT** — pit stop service duration
- **Inlap** — lap time on the final lap before pitting
- **Outlap** — lap time on the first lap on fresh tyres
- **SafetyCar** — probability of a safety car on a given lap

These five models were trained and evaluated independently (Table 1). However, during development it became clear that only **LapTimePerKM** was needed by the strategy optimizer. PitstopT (R² = 0.373) was replaced by a simple per-circuit median from real pit stop data, which gives the same accuracy without the overhead of an ML model — it only had one feature (GP) so it was effectively a lookup table already. Inlap and Outlap were dropped because their effects are already captured in the aggregate pit cost; using them separately would double-count the time penalty. SafetyCar (ROC-AUC = 0.499) performed at chance level — crashes are fundamentally unpredictable — and was excluded entirely.

The final optimizer combines the LapTimePerKM model with two data-driven components: (1) per-circuit, per-compound tyre degradation rates computed from fuel-corrected stint analysis of 91,955 real laps, and (2) compound pace offsets from Pirelli technical data (-0.85s for SOFT, +0.55s for HARD vs MEDIUM baseline per lap). It enumerates valid pit configurations (≥2 tyre compounds, ≤3 stops, ≥5 laps per stint) and ranks them by estimated total race time, giving strategy engineers a ranked list of 1-stop, 2-stop, and 3-stop options for any circuit and driver.

## 2. Dataset Identification

Four data sources were used, all publicly available:

- **FastF1 (Python API):** Official F1 telemetry (lap times, tyre compound, pit stop records) for 2019–2024.
- **Kaggle F1 Dataset (1950–2024):** Historical race results and constructor data for team and driver identifiers.
- **Ergast/Jolpica API:** Circuit metadata (coordinates, race schedules), cached locally to avoid rate limits.
- **CircuitInfo.csv:** Hand-compiled Pirelli tyre stress ratings per circuit (abrasion, traction, braking, lateral load, asphalt age) for 32+ circuits.

Wet-compound laps (INTERMEDIATE/WET) were dropped to focus on dry-race degradation. The 107% rule removed formation laps and outliers. Compounds were standardized to SOFT, MEDIUM, and HARD. Pit stop records were validated against a 10-60 second service window (92.8% pass rate). Final dataset: 93,577 laps, 4,020 pit stops, 6,052 stints, 111 races, 34 circuits across 2019-2024.

## 3. Feature Engineering and Validation Strategy

Features were chosen based on what would plausibly be known at the time of the decision. Post-race outcomes and whole-stint aggregates derived from future laps were excluded to prevent leakage.

LapTimePerKM uses RacePercentage, TyreLife, Position, Stint, GP, Driver, Team, and Compound. PitstopT uses GP only; service time reflects pit lane infrastructure, not driver behaviour. Inlap uses TyreLife, Stint, GP, and Compound. Outlap adds Position and RacePercentage. SafetyCar uses LapNumber and GP. All models share a scikit-learn Pipeline: median imputation + StandardScaler for numerics; mode imputation + OneHotEncoder for categoricals.

Validation used a temporal holdout: 2019-2023 for training, 2024 as a held-out test season. This reflects real deployment conditions; the model must generalize to a future season it was never trained on.

## 4. Model Implementation and Evaluation

For each target, Random Forest and Gradient Boosting (scikit-learn) were both trained on the same pipeline, and the better algorithm was auto-selected by the primary metric: R² for regressions, ROC-AUC for classification. Results on the 2024 holdout are shown in Table 1.

**Table 1 — Model Performance on 2024 Holdout Test Set**

| Model | Task | Algorithm | R² / ROC-AUC | MAE / F1 |
|---|---|---|---|---|
| LapTimePerKM | Regression | Gradient Boosting | R² = 0.913 | MAE = 0.356 s/km |
| PitstopT | Regression | Random Forest | R² = 0.373 | MAE = 2.08 s |
| Inlap | Regression | Gradient Boosting | R² = 0.505 | MAE = 1.48 s |
| Outlap | Regression | Gradient Boosting | R² = 0.151 | MAE = 1.44 s |
| SafetyCar | Classification | Gradient Boosting | ROC-AUC = 0.499 | F1 = 0.00 |

LapTimePerKM is the strongest model (R² = 0.913) and the only one used in the final strategy optimizer. Lap pace is well-explained by tyre age, race progress, compound, and circuit; this model drives the bulk of the optimizer's accuracy. The remaining four models were trained as part of an initial design that modelled each component of a pit stop separately (in-lap slowdown + stationary time + out-lap slowdown + safety car probability). During integration, three findings led to their removal:

**PitstopT** (R² = 0.373) had only one feature (GP), making it functionally equivalent to a per-circuit average. It was replaced by a direct lookup of median pit stop times from Pitstops.csv (~4,000 real pit stops, filtered to a 10–60s service window). For circuits without data, the system falls back to the overall median of 23.5s.

**Inlap** (R² = 0.505) and **Outlap** (R² = 0.151) captured some of the pace variation entering and exiting the pits, but this effect is already embedded in the aggregate pit cost data. Applying these models on top of PitstopT would double-count the penalty. The outlap model was also weak (R² = 0.151) — cold-tyre warm-up behaviour varies heavily by driver style and traffic, neither of which appear in the feature set.

**SafetyCar** (ROC-AUC = 0.499) performed at chance level. Safety cars are caused by on-track incidents — inherently stochastic events with no detectable signal in lap-level features. The model was excluded from the optimizer. It is retained only for a mid-race re-optimization endpoint, where the safety_car=True flag applies a 12s pit cost discount after a safety car has already been deployed.

**Tyre degradation** is not predicted by any ML model. Instead, per-circuit, per-compound degradation rates (s/lap) are computed offline from real stint data using a fuel-corrected analysis: for each stint, the fuel benefit (~0.06s/lap from weight reduction) is added back to the raw lap time increase, isolating true tyre wear. The median rate per (circuit, compound) pair is stored in DegradationRates.csv (99 entries across 34 circuits). This approach avoids the confounding between compound choice and fuel load that would bias an ML model — in the training data, hard tyres appear artificially fast because they are run late in races when cars are light.

**Compound pace offsets** (-0.85s for SOFT, +0.55s for HARD vs MEDIUM per lap) are taken from Pirelli technical data rather than derived from race data. Attempts to learn these offsets from lap times failed due to the same fuel-load confound: the ML model learned that hard tyres are "faster" because they correlate with low fuel, not because they have better grip.

## 5. Critical Reflection

**Construct validity.** The LapTimePerKM model learns observed lap pace patterns, not tyre physics directly. Circuit-specific tyre degradation is handled separately through a data-driven pipeline that computes fuel-corrected wear rates from real stint data, which is more physically grounded than letting the ML model learn degradation implicitly. However, the compound pace offsets remain hardcoded from Pirelli data — a source that cannot be independently verified and may not generalize across regulation changes. The 1.4s/lap swing between SOFT and HARD compounds has outsized leverage on strategy selection: over a 70-lap race, a 10% error in these offsets shifts predicted race time by ~10s, enough to change which strategy is ranked first.

**Distributional shift.** The 2022 regulation change (ground-effect aerodynamics) fundamentally changed tyre loading. Training data from 2019–2021 carries partially wrong priors for 2022+ degradation. The temporal holdout is realistic about this, but it also means the model will need retraining each season as the technical regulations evolve.

**SafetyCar failure.** Race incidents are inherently unpredictable. Excluding the SafetyCar model from the optimizer is the right practical decision. Still, it means the system cannot reason about opportunistic pit windows under neutralization, a significant gap given how often safety cars swing real race outcomes.

**Data imbalance across teams.** Top teams (Red Bull, Mercedes, Ferrari) generate far more laps of clean data than midfield or backmarker teams. Predictions are likely less reliable for smaller teams, which is a fairness concern if the tool were ever deployed commercially.

**Evaluation metric limitations.** R² tells us how well a model explains variance relative to the mean, but what actually matters for the strategy optimizer is whether the predicted race time ordering of strategies is correct, not the absolute error on any individual lap. A model with R² = 0.913 could still rank two strategies incorrectly if their predicted times are very close. A more operationally meaningful metric would be ranking accuracy across strategy candidates — for example, comparing the optimizer's top-ranked strategy against the strategy that actually won each 2024 race — which was not evaluated here. Additionally, the four unused models (PitstopT, Inlap, Outlap, SafetyCar) highlight a broader lesson: high-dimensional supervised models are not always superior to domain-informed averages. PitstopT's single-feature Random Forest was outperformed by a simple median; the degradation pipeline's fuel-corrected stint analysis outperformed letting the ML model learn wear patterns implicitly.

**Practical deployment gap.** In a real race environment, strategy calls happen in seconds. The current system is an offline batch predictor that assumes a fixed race length and does not react to live track conditions (tyre temperature, weather changes, virtual safety cars). Bridging this gap would require live telemetry ingestion, low-latency inference, and confidence intervals rather than point estimates, none of which are addressed here.

## Appendix - Reproducibility

Retrain models: `cd f1_strategy && make strategy-train` | Serve API: `make serve` | Frontend: `cd ui && npm install && npm run dev`

Per-circuit degradation rates: `cd f1_strategy && python scripts/build_deg_table.py` (writes `data/processed/DegradationRates.csv`)

Unused model rationale: `f1_strategy/f1pit/models/unused_models.py`

Artifacts (trained models + evaluation metrics): `f1_strategy/artifacts/strategy_20260307_151844/`

All cleaned CSVs in `data/`; FastF1 requires `fastf1` Python package; Kaggle data requires Kaggle API credentials.
