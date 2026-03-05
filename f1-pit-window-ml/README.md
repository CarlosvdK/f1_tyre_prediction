# Predicting Pit Stop Timing / Stint End in Formula 1

Supervised ML final project repository for **Artificial Intelligence II**.

## Course Context
- Course: Artificial Intelligence II final project (supervised learning).
- Deliverables: 3-page report, 5-minute presentation + Q&A, reproducible code.
- Rubric alignment: problem formulation clarity, data/model appropriateness, rigorous evaluation, metric justification to objective, critical reflection depth, organization.

## Problem Definition
Decision supported: **pit window planning** in race strategy.

Primary task (implemented): binary classification `PIT_SOON` predicting whether a driver will pit within the next `K` laps (`K=3` default).

Business framing: this acts like a buy-now vs wait decision for pit calls where teams trade track position against tyre performance decline.

## Data Identification
1. Kaggle historical F1 dataset (downloaded with `kagglehub`):
   - `lap_times`, `pit_stops`, `races`, `results`, `constructors`, `drivers`, `circuits`
2. Ergast-compatible Jolpica API (optional, cached):
   - Supplemental race schedule/circuit metadata cached in `data/raw/ergast_cache/*.json`
   - Toggle via `--use_ergast 1/0`

Pipeline runs with Kaggle + Ergast only. FastF1 is **not required**.

## Label Construction
For each `(race_id, driver_id, lap_number)`:
- `PIT_SOON=1` if there exists a pit stop lap `L_pit` such that
  `lap_number <= L_pit <= lap_number + K`
- Else `0`

For decision relevance, laps after the final pit in a race-driver sequence are excluded from training/evaluation.

## Feature Engineering
See detailed rationale: [reports/feature_rationale.md](reports/feature_rationale.md).

Implemented feature groups:
- Stint context proxies: `laps_since_last_pit`, `last_pit_lap`, `stint_number`
- Pace/degradation proxies: raw lap time, rolling means/std, delta from stint-best lap (past laps only), rolling slope (pseudo-telemetry trend)
- Added robustness features: lap-time delta vs previous lap, delta vs recent rolling mean, laps remaining, and within-lap pace percentile proxy
- Race context: lap number, normalized lap number, year/circuit/country, optional Ergast location fields
- Competition proxy: official lap `track_position` if available; fallback proxy `lap_time_rank_in_lap`

Excluded features:
- Final race outcomes (`positionOrder`, points, final position)
- Any future-derived signals (e.g., full-stint averages)
- Direct next-pit information not available at decision time

## Validation and Leakage Avoidance
- Default: `GroupKFold` on grouped unit `(race_id, driver_id)`.
- Alternative: season holdout (`train <= N-1`, test `== N`) to assess temporal shift.
- Leakage checks enforce banned feature patterns and split keys.

## Models
- Baseline: `LogisticRegression` with class balancing and preprocessing pipeline.
- Stronger models: `RandomForestClassifier` and `GradientBoostingClassifier`.
- Training compares candidates and auto-selects the best model by PR-AUC (tie-breaker: strategy precision@top3).
- Interpretability: permutation importance plot.

## Evaluation
Primary: **PR-AUC**.
Also reported: ROC-AUC, F1, precision, recall, confusion matrix, Brier score.
Strategy-oriented metric: precision@top3 predicted laps per race-driver (did top alerts capture true pit timing windows?).

Error analysis slices:
- circuit
- year and era (`pre_2010` vs `post_2010`)
- `stint_number`
- `laps_since_last_pit` buckets

## Critical Reflection
Construct validity limits and confounding are explicitly addressed:
- Pit timing is not pure tyre degradation (undercut/overcut, damage, race control events).
- Missing variables (compound, fuel, setup, telemetry) limit causal interpretation.
- Distribution shift across regulations/eras impacts generalization.
- Leakage risks mitigated with grouped/temporal splits and feature policy.

## Quickstart
```bash
cd f1-pit-window-ml
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export PYTHONPATH=src

python -m f1pit.data.download_kaggle
python -m f1pit.data.fetch_ergast --year 2019
python -m f1pit.data.build_tables --years 2018 2019 --use_ergast 1 --small 1
python -m f1pit.models.train --k_pit 3 --mode groupkfold --small 1
python -m f1pit.models.evaluate --artifact_dir artifacts/latest
```

For better final-model accuracy, run the same commands with `--small 0` and include more years.

End-to-end helper:
```bash
bash scripts/run_end_to_end.sh
```

## Artifacts
Each training run writes to `artifacts/<timestamp>/`:
- `model.joblib`
- `metrics.json`
- `predictions.parquet`
- `plots/*.png`

`artifacts/latest` is updated to the newest run.
