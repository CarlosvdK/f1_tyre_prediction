from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.base import clone
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.utils.class_weight import compute_sample_weight

from f1pit.config import PATHS, RANDOM_SEED
from f1pit.features.engineer import FeatureBuildConfig, build_supervised_table, default_feature_columns
from f1pit.features.leakage_checks import assert_no_obvious_leakage
from f1pit.utils.io import load_parquet, save_parquet, write_json
from f1pit.utils.logging import get_logger
from f1pit.viz.plots import plot_calibration, plot_confusion, plot_feature_importance, plot_pr_roc

LOGGER = get_logger(__name__)


def _make_preprocessor(numeric_cols: list[str], categorical_cols: list[str]) -> ColumnTransformer:
    num_pipe = Pipeline(
        steps=[("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler())]
    )
    cat_pipe = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ]
    )
    return ColumnTransformer(
        transformers=[("num", num_pipe, numeric_cols), ("cat", cat_pipe, categorical_cols)]
    )


def _strategy_precision_at_top_n(pred_df: pd.DataFrame, top_n: int = 3) -> float:
    rows = []
    for _, g in pred_df.groupby(["race_id", "driver_id"]):
        g = g.dropna(subset=["y_prob"])
        if g.empty:
            continue
        top = g.nlargest(top_n, "y_prob")
        rows.append(float(top["target"].max() > 0))
    if not rows:
        return float("nan")
    return float(np.mean(rows))


def _safe_metric(metric_fn, y_true: np.ndarray, y_prob: np.ndarray) -> float:
    try:
        return float(metric_fn(y_true, y_prob))
    except ValueError:
        return float("nan")


def _best_f1_threshold(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    precision, recall, thresholds = precision_recall_curve(y_true, y_prob)
    if len(thresholds) == 0:
        return 0.5
    f1 = (2 * precision[:-1] * recall[:-1]) / np.clip(precision[:-1] + recall[:-1], 1e-12, None)
    return float(thresholds[int(np.nanargmax(f1))])


def _classification_metrics(y_true: np.ndarray, y_prob: np.ndarray, threshold: float | None = None) -> dict[str, float]:
    eval_mask = np.isfinite(y_prob)
    y_eval = y_true[eval_mask]
    p_eval = y_prob[eval_mask]
    if len(y_eval) == 0:
        raise ValueError("No finite predictions available for metric computation.")

    effective_threshold = _best_f1_threshold(y_eval, p_eval) if threshold is None else float(threshold)
    y_pred = (p_eval >= effective_threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_eval, y_pred, labels=[0, 1]).ravel()
    return {
        "n_eval_rows": int(len(y_eval)),
        "best_f1_threshold": float(effective_threshold),
        "pr_auc": _safe_metric(average_precision_score, y_eval, p_eval),
        "roc_auc": _safe_metric(roc_auc_score, y_eval, p_eval),
        "f1": float(f1_score(y_eval, y_pred, zero_division=0)),
        "precision": float(precision_score(y_eval, y_pred, zero_division=0)),
        "recall": float(recall_score(y_eval, y_pred, zero_division=0)),
        "brier": _safe_metric(brier_score_loss, y_eval, p_eval),
        "tn": int(tn),
        "fp": int(fp),
        "fn": int(fn),
        "tp": int(tp),
    }


def _oof_predict(
    pipeline: Pipeline,
    X: pd.DataFrame,
    y: np.ndarray,
    split_iter,
    sample_weight: np.ndarray | None = None,
) -> np.ndarray:
    oof = np.full(shape=len(X), fill_value=np.nan, dtype=float)
    for fold, (tr_idx, te_idx) in enumerate(split_iter, start=1):
        X_tr, X_te = X.iloc[tr_idx], X.iloc[te_idx]
        y_tr = y[tr_idx]
        model = clone(pipeline)
        fit_kwargs = {}
        if sample_weight is not None:
            fit_kwargs["model__sample_weight"] = sample_weight[tr_idx]
        try:
            model.fit(X_tr, y_tr, **fit_kwargs)
        except TypeError:
            model.fit(X_tr, y_tr)
        oof[te_idx] = model.predict_proba(X_te)[:, 1]
        LOGGER.info("Completed fold %s | train=%s test=%s", fold, len(tr_idx), len(te_idx))
    return oof


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train pit-window classification models")
    parser.add_argument("--data_path", type=str, default=str(PATHS.data_processed / "lap_level.parquet"))
    parser.add_argument("--k_pit", type=int, default=3)
    parser.add_argument("--mode", type=str, default="groupkfold", choices=["groupkfold", "season_holdout"])
    parser.add_argument("--holdout_year", type=int, default=2019)
    parser.add_argument("--small", type=int, default=0, choices=[0, 1])
    parser.add_argument("--output_dir", type=str, default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    lap_df = load_parquet(Path(args.data_path))
    if bool(args.small):
        keep_cols = ["race_id", "driver_id"]
        ids = lap_df[keep_cols].drop_duplicates().head(30)
        lap_df = lap_df.merge(ids, on=keep_cols, how="inner")
        LOGGER.info("Small mode active: reduced to %s rows", len(lap_df))

    feat_cfg = FeatureBuildConfig(k_pit=args.k_pit, task="classification")
    df = build_supervised_table(lap_df, feat_cfg)

    numeric_cols, categorical_cols = default_feature_columns()
    feature_cols = [c for c in numeric_cols + categorical_cols if c in df.columns]
    assert_no_obvious_leakage(df, feature_cols, task="classification")

    X = df[feature_cols].copy()
    y = df["target"].astype(int).to_numpy()

    preprocessor = _make_preprocessor(
        [c for c in numeric_cols if c in feature_cols],
        [c for c in categorical_cols if c in feature_cols],
    )

    logit = Pipeline(
        steps=[
            ("prep", preprocessor),
            (
                "model",
                LogisticRegression(
                    max_iter=1000,
                    class_weight="balanced",
                    random_state=RANDOM_SEED,
                ),
            ),
        ]
    )

    rf = Pipeline(
        steps=[
            ("prep", preprocessor),
            (
                "model",
                RandomForestClassifier(
                    n_estimators=300,
                    min_samples_leaf=2,
                    class_weight="balanced_subsample",
                    random_state=RANDOM_SEED,
                    n_jobs=-1,
                ),
            ),
        ]
    )

    gb = Pipeline(
        steps=[
            ("prep", preprocessor),
            (
                "model",
                GradientBoostingClassifier(
                    n_estimators=300,
                    learning_rate=0.05,
                    max_depth=3,
                    min_samples_leaf=20,
                    subsample=0.8,
                    random_state=RANDOM_SEED,
                ),
            ),
        ]
    )

    model_candidates: dict[str, Pipeline] = {
        "logistic_regression": logit,
        "random_forest": rf,
        "gradient_boosting": gb,
    }

    if args.mode == "groupkfold":
        groups = df["race_id"].astype(str) + "_" + df["driver_id"].astype(str)
        splitter = GroupKFold(n_splits=5)
        splits = list(splitter.split(X, y, groups=groups))
        split_name = "groupkfold"
    else:
        train_idx = df.index[df["year"].fillna(-1).astype(int) <= args.holdout_year - 1].to_numpy()
        test_idx = df.index[df["year"].fillna(-1).astype(int) == args.holdout_year].to_numpy()
        if len(train_idx) == 0 or len(test_idx) == 0:
            raise ValueError(
                f"No samples for season_holdout with holdout_year={args.holdout_year}."
            )
        splits = [(train_idx, test_idx)]
        split_name = f"season_holdout_{args.holdout_year}"

    pred_df = df[["race_id", "driver_id", "year", "circuit_id", "stint_number", "laps_since_last_pit", "target"]].copy()
    sample_weight = compute_sample_weight(class_weight="balanced", y=y)

    oof_by_model: dict[str, np.ndarray] = {}
    metrics_by_model: dict[str, dict[str, float]] = {}
    for name, pipeline in model_candidates.items():
        weight_vec = sample_weight if name == "gradient_boosting" else None
        oof = _oof_predict(pipeline, X, y, splits, sample_weight=weight_vec)
        oof_by_model[name] = oof

        model_metrics = _classification_metrics(y, oof)
        strategy_df = pred_df.copy()
        strategy_df["y_prob"] = oof
        model_metrics["strategy_precision_at_top3"] = _strategy_precision_at_top_n(
            strategy_df[["race_id", "driver_id", "target", "y_prob"]]
        )
        metrics_by_model[name] = model_metrics
        pred_df[f"y_prob_{name}"] = oof

    selected_name = max(
        metrics_by_model,
        key=lambda m: (
            np.nan_to_num(metrics_by_model[m]["pr_auc"], nan=-1.0),
            np.nan_to_num(metrics_by_model[m]["strategy_precision_at_top3"], nan=-1.0),
        ),
    )
    selected_pipeline = model_candidates[selected_name]
    selected_probs = oof_by_model[selected_name]
    selected_threshold = metrics_by_model[selected_name]["best_f1_threshold"]

    final_weight_vec = sample_weight if selected_name == "gradient_boosting" else None
    if final_weight_vec is not None:
        try:
            selected_pipeline.fit(X, y, model__sample_weight=final_weight_vec)
        except TypeError:
            selected_pipeline.fit(X, y)
    else:
        selected_pipeline.fit(X, y)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    artifact_dir = Path(args.output_dir) if args.output_dir else PATHS.artifacts / timestamp
    plots_dir = artifact_dir / "plots"
    artifact_dir.mkdir(parents=True, exist_ok=True)

    pred_df["y_prob"] = selected_probs
    pred_df["is_eval_row"] = np.isfinite(pred_df["y_prob"]).astype(int)
    pred_df["y_pred"] = np.where(
        np.isfinite(pred_df["y_prob"]),
        (pred_df["y_prob"] >= selected_threshold).astype(int),
        np.nan,
    )
    save_parquet(pred_df, artifact_dir / "predictions.parquet")

    metrics = {
        "mode": split_name,
        "k_pit": int(args.k_pit),
        "selected_model": selected_name,
        "selected_threshold": float(selected_threshold),
        "logistic_regression": metrics_by_model["logistic_regression"],
        "random_forest": metrics_by_model["random_forest"],
        "gradient_boosting": metrics_by_model["gradient_boosting"],
    }
    write_json(metrics, artifact_dir / "metrics.json")

    joblib.dump(
        {
            "pipeline": selected_pipeline,
            "feature_cols": feature_cols,
            "numeric_cols": [c for c in numeric_cols if c in feature_cols],
            "categorical_cols": [c for c in categorical_cols if c in feature_cols],
            "k_pit": args.k_pit,
            "task": "classification",
        },
        artifact_dir / "model.joblib",
    )

    eval_mask = np.isfinite(selected_probs)
    y_eval = y[eval_mask]
    p_eval = selected_probs[eval_mask]
    plot_pr_roc(y_eval, p_eval, plots_dir)
    plot_calibration(y_eval, p_eval, plots_dir)
    plot_confusion(y_eval, (p_eval >= selected_threshold).astype(int), plots_dir)

    # Permutation importance on a sampled subset to keep runtime practical.
    sample_n = min(5000, len(X))
    sample_idx = np.random.RandomState(RANDOM_SEED).choice(len(X), size=sample_n, replace=False)
    X_sample = X.iloc[sample_idx]
    y_sample = y[sample_idx]
    pi = permutation_importance(
        selected_pipeline,
        X_sample,
        y_sample,
        n_repeats=5,
        random_state=RANDOM_SEED,
        scoring="average_precision",
    )
    plot_feature_importance(feature_cols, pi.importances_mean, plots_dir)

    latest_link = PATHS.artifacts / "latest"
    if latest_link.exists() or latest_link.is_symlink():
        latest_link.unlink()
    latest_link.symlink_to(artifact_dir.resolve(), target_is_directory=True)

    LOGGER.info("Training completed. Selected model=%s", selected_name)
    LOGGER.info("Artifacts written to %s", artifact_dir)


if __name__ == "__main__":
    main()
