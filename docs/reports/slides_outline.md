# 5-Minute Presentation Outline + Q&A Prep

## Slide 1 (40s): Problem Framing
- Why pit timing matters for race outcome.
- Prediction target and tactical use.

## Slide 2 (50s): Data + Label
- Kaggle + Ergast data sources.
- PIT_SOON label construction with K-lap window.

## Slide 3 (60s): Features + Leakage Policy
- Stint, pace trend, context, competition proxies.
- Excluded features and decision-time constraints.

## Slide 4 (70s): Models + Validation
- Baseline logistic vs random forest.
- GroupKFold + season holdout rationale.

## Slide 5 (70s): Results + Error Slices
- PR-AUC primary, plus calibration and strategy-topN metric.
- Slice failures and interpretation.

## Slide 6 (50s): Critical Reflection
- Construct validity and confounding.
- Missing telemetry and next steps for realistic team usage.

## Q&A Prompts
- Why PR-AUC over accuracy/ROC-AUC?
- How is leakage prevented in rolling features and splits?
- What variables are missing for causal tyre degradation inference?
- How robust are findings across regulation eras?
