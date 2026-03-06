from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score

from f1pit.utils.io import load_parquet, write_json
from f1pit.utils.logging import get_logger
from f1pit.viz.plots import plot_calibration, plot_confusion, plot_pr_roc

LOGGER = get_logger(__name__)


def _best_f1_threshold(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    precision, recall, thresholds = precision_recall_curve(y_true, y_prob)
    f1 = (2 * precision * recall) / np.clip(precision + recall, 1e-12, None)
    if len(thresholds) == 0:
        return 0.5
    best = int(np.nanargmax(f1[:-1]))
    return float(thresholds[best])


def _safe_metric(metric_fn, y_true: np.ndarray, y_prob: np.ndarray) -> float:
    try:
        return float(metric_fn(y_true, y_prob))
    except ValueError:
        return float("nan")


def _slice_metric(df: pd.DataFrame, key: str) -> pd.DataFrame:
    rows = []
    for value, g in df.groupby(key, dropna=False):
        if g["target"].nunique() < 2:
            continue
        rows.append(
            {
                "slice": key,
                "value": str(value),
                "n": int(len(g)),
                "pr_auc": _safe_metric(average_precision_score, g["target"], g["y_prob"]),
                "roc_auc": _safe_metric(roc_auc_score, g["target"], g["y_prob"]),
                "positive_rate": float(g["target"].mean()),
            }
        )
    return pd.DataFrame(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate saved predictions and produce slice diagnostics")
    parser.add_argument("--artifact_dir", type=str, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    artifact_dir = Path(args.artifact_dir)

    pred_path = artifact_dir / "predictions.parquet"
    if not pred_path.exists():
        raise FileNotFoundError(f"Missing predictions file: {pred_path}")

    df = load_parquet(pred_path)
    n_rows_total = int(len(df))
    df = df[df["y_prob"].notna()].copy()
    if df.empty:
        raise ValueError("No rows with finite y_prob were found in predictions.parquet.")

    y_true = df["target"].astype(int).to_numpy()
    y_prob = df["y_prob"].astype(float).to_numpy()

    threshold = _best_f1_threshold(y_true, y_prob)
    y_pred = (y_prob >= threshold).astype(int)

    overall = {
        "pr_auc": _safe_metric(average_precision_score, y_true, y_prob),
        "roc_auc": _safe_metric(roc_auc_score, y_true, y_prob),
        "best_f1_threshold": float(threshold),
        "n_rows_total": n_rows_total,
        "n_rows_evaluated": int(len(df)),
        "positive_rate": float(np.mean(y_true)),
    }

    df_eval = df.copy()
    if "year" in df_eval.columns:
        df_eval["era"] = np.where(df_eval["year"].fillna(0).astype(int) < 2010, "pre_2010", "post_2010")
    if "laps_since_last_pit" in df_eval.columns:
        df_eval["laps_since_bucket"] = pd.cut(
            df_eval["laps_since_last_pit"],
            bins=[-0.1, 3, 8, 15, 100],
            labels=["0-3", "4-8", "9-15", "16+"],
        )

    slices = []
    for key in ["circuit_id", "year", "era", "stint_number", "laps_since_bucket"]:
        if key in df_eval.columns:
            s = _slice_metric(df_eval, key)
            if not s.empty:
                slices.append(s)

    slice_df = pd.concat(slices, ignore_index=True) if slices else pd.DataFrame()
    slice_path = artifact_dir / "slice_metrics.csv"
    slice_df.to_csv(slice_path, index=False)

    plots_dir = artifact_dir / "plots"
    plot_pr_roc(y_true, y_prob, plots_dir)
    plot_calibration(y_true, y_prob, plots_dir)
    plot_confusion(y_true, y_pred, plots_dir)

    write_json(overall, artifact_dir / "evaluation_summary.json")
    LOGGER.info("Evaluation summary saved to %s", artifact_dir / "evaluation_summary.json")
    LOGGER.info("Slice metrics saved to %s", slice_path)


if __name__ == "__main__":
    main()
