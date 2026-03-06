from __future__ import annotations

import argparse
from pathlib import Path

import joblib

from f1pit.config import PATHS
from f1pit.features.engineer import FeatureBuildConfig, build_supervised_table
from f1pit.utils.io import load_parquet, save_parquet
from f1pit.utils.logging import get_logger

LOGGER = get_logger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Score laps for pit-soon probability")
    parser.add_argument("--model_path", type=str, default=str(PATHS.artifacts / "latest" / "model.joblib"))
    parser.add_argument("--input_path", type=str, default=str(PATHS.data_processed / "lap_level.parquet"))
    parser.add_argument("--output_path", type=str, default=str(PATHS.artifacts / "latest" / "inference_predictions.parquet"))
    parser.add_argument("--k_pit", type=int, default=3)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    artifact = joblib.load(Path(args.model_path))
    model = artifact["pipeline"]
    feature_cols = artifact["feature_cols"]

    lap_df = load_parquet(Path(args.input_path))
    feat_df = build_supervised_table(
        lap_df,
        FeatureBuildConfig(k_pit=args.k_pit, task="classification"),
    )

    X = feat_df[feature_cols].copy()
    feat_df["pit_soon_probability"] = model.predict_proba(X)[:, 1]
    out_cols = [
        "race_id",
        "driver_id",
        "lap_number",
        "pit_soon_probability",
        "target",
    ]
    out_cols = [c for c in out_cols if c in feat_df.columns]
    save_parquet(feat_df[out_cols], Path(args.output_path))

    LOGGER.info("Saved predictions to %s", args.output_path)


if __name__ == "__main__":
    main()
