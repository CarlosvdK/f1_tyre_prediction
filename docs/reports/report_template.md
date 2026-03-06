# 3-Page Report Template (AI II Final Project)

## 1. Problem and Objective (0.5 page)
- Real-world decision: pit window planning in F1 race strategy.
- Supervised objective: classify if pit occurs within next K laps.
- Why this target matters operationally.

## 2. Data Identification and Quality (0.5 page)
- Kaggle dataset tables used and join logic.
- Ergast/Jolpica supplemental metadata and caching approach.
- Data quality issues across eras; missingness handling.

## 3. Labeling and Feature Engineering (0.75 page)
- Label definition with equations.
- Feature groups and rationale tied to tyre degradation proxies.
- Leakage exclusions and decision-time information constraints.

## 4. Modeling and Validation (0.5 page)
- Baseline logistic regression and stronger tree model.
- GroupKFold and season holdout protocols.
- Imbalance handling and thresholding policy.

## 5. Results and Error Analysis (0.5 page)
- Primary metric PR-AUC + secondary metrics.
- Slice analysis by circuit, era, stint number, laps-since-last-pit buckets.
- Strategy-oriented metric interpretation.

## 6. Critical Reflection and Relevance (0.25 page)
- Construct validity limitations.
- Confounding (safety cars, strategy calls, damage) and omitted variables.
- Distribution shift and implications for deployment.

## 7. Appendix (optional)
- Reproducibility commands, artifact paths, compute settings.
