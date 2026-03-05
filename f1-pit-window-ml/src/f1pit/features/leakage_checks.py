from __future__ import annotations

import pandas as pd


BANNED_FEATURE_PATTERNS = [
    "positionorder",  # final race result leakage
    "points",         # post-outcome information
    "next_pit_lap",   # direct target leakage
    "laps_to_pit",    # direct target leakage for classification
]


def assert_no_obvious_leakage(df: pd.DataFrame, feature_cols: list[str], task: str = "classification") -> None:
    lower_cols = [c.lower() for c in feature_cols]
    for bad in BANNED_FEATURE_PATTERNS:
        if any(bad in c for c in lower_cols):
            raise AssertionError(f"Potential leakage feature detected: pattern={bad}")

    if "target" not in df.columns:
        raise AssertionError("target column is missing")

    if task == "classification":
        unique = sorted(df["target"].dropna().unique().tolist())
        if any(v not in [0, 1] for v in unique):
            raise AssertionError(f"Classification target must be binary 0/1, got {unique[:10]}")

    required_context = {"race_id", "driver_id", "lap_number"}
    missing = required_context - set(df.columns)
    if missing:
        raise AssertionError(f"Missing contextual columns for leakage-safe splitting: {sorted(missing)}")
