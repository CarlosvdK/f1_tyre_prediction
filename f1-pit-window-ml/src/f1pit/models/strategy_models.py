"""
Strategy models: 5 separate ML models for F1 race strategy estimation.

1. LapTimePerKM – predict normalized lap time (regression)
2. PitstopT    – predict pit stop duration (regression)
3. Inlap       – predict inlap LapTimePerKM (regression)
4. Outlap      – predict outlap LapTimePerKM (regression)
5. SafetyCar   – predict safety car probability (classification)

Each model compares Random Forest vs Gradient Boosting and auto-selects the best.
Train on 2019-2023, test on 2024.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import (
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    mean_absolute_error,
    mean_squared_error,
    r2_score,
    roc_auc_score,
    average_precision_score,
    f1_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from f1pit.config import PATHS, RANDOM_SEED
from f1pit.features.strategy_features import (
    INLAP_FEATURES_CATEGORICAL,
    INLAP_FEATURES_NUMERIC,
    LAP_TIME_FEATURES_CATEGORICAL,
    LAP_TIME_FEATURES_NUMERIC,
    OUTLAP_FEATURES_CATEGORICAL,
    OUTLAP_FEATURES_NUMERIC,
    PITSTOP_FEATURES_CATEGORICAL,
    PITSTOP_FEATURES_NUMERIC,
    SC_FEATURES_CATEGORICAL,
    SC_FEATURES_NUMERIC,
    StrategyFeatureConfig,
    prepare_inlap_data,
    prepare_lap_time_data,
    prepare_outlap_data,
    prepare_pitstop_data,
    prepare_safety_car_data,
    split_train_test,
)
from f1pit.utils.io import write_json
from f1pit.utils.logging import get_logger

LOGGER = get_logger(__name__)


@dataclass
class ModelResult:
    """Result of training a single model."""
    name: str
    model_type: str  # "random_forest" or "gradient_boosting"
    pipeline: Pipeline
    metrics: dict[str, float]
    feature_cols: list[str]
    numeric_cols: list[str]
    categorical_cols: list[str]
    target_col: str
    task: str  # "regression" or "classification"


def _make_preprocessor(
    numeric_cols: list[str],
    categorical_cols: list[str],
) -> ColumnTransformer:
    """Build a ColumnTransformer for mixed numeric/categorical features."""
    transformers = []

    if numeric_cols:
        num_pipe = Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ])
        transformers.append(("num", num_pipe, numeric_cols))

    if categorical_cols:
        cat_pipe = Pipeline([
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ])
        transformers.append(("cat", cat_pipe, categorical_cols))

    return ColumnTransformer(transformers=transformers)


def _train_and_compare(
    X_train: pd.DataFrame,
    y_train: np.ndarray,
    X_test: pd.DataFrame,
    y_test: np.ndarray,
    numeric_cols: list[str],
    categorical_cols: list[str],
    task: str = "regression",
    model_name: str = "model",
) -> tuple[str, Pipeline, dict[str, float]]:
    """
    Train RF and GB models, compare on test set, return the best.

    For regression: compare by MAE (lower is better).
    For classification: compare by ROC AUC (higher is better).
    """
    # Filter to columns that actually exist in the data
    num_cols = [c for c in numeric_cols if c in X_train.columns]
    cat_cols = [c for c in categorical_cols if c in X_train.columns]

    if not num_cols and not cat_cols:
        raise ValueError(f"No usable feature columns for {model_name}")

    preprocessor = _make_preprocessor(num_cols, cat_cols)
    feature_cols = num_cols + cat_cols

    if task == "regression":
        candidates = {
            "random_forest": Pipeline([
                ("prep", preprocessor),
                ("model", RandomForestRegressor(
                    n_estimators=300,
                    min_samples_leaf=5,
                    max_depth=15,
                    random_state=RANDOM_SEED,
                    n_jobs=-1,
                )),
            ]),
            "gradient_boosting": Pipeline([
                ("prep", preprocessor),
                ("model", GradientBoostingRegressor(
                    n_estimators=300,
                    learning_rate=0.05,
                    max_depth=5,
                    min_samples_leaf=10,
                    subsample=0.8,
                    random_state=RANDOM_SEED,
                )),
            ]),
        }
    else:
        candidates = {
            "random_forest": Pipeline([
                ("prep", preprocessor),
                ("model", RandomForestClassifier(
                    n_estimators=300,
                    min_samples_leaf=5,
                    class_weight="balanced_subsample",
                    random_state=RANDOM_SEED,
                    n_jobs=-1,
                )),
            ]),
            "gradient_boosting": Pipeline([
                ("prep", preprocessor),
                ("model", GradientBoostingClassifier(
                    n_estimators=300,
                    learning_rate=0.05,
                    max_depth=3,
                    min_samples_leaf=10,
                    subsample=0.8,
                    random_state=RANDOM_SEED,
                )),
            ]),
        }

    best_name = ""
    best_pipeline = None
    best_metrics: dict[str, float] = {}
    best_score = float("inf") if task == "regression" else float("-inf")

    for name, pipeline in candidates.items():
        LOGGER.info("  Training %s / %s ...", model_name, name)
        X_tr = X_train[feature_cols].copy()
        X_te = X_test[feature_cols].copy()

        pipeline.fit(X_tr, y_train)

        if task == "regression":
            y_pred = pipeline.predict(X_te)
            mae = mean_absolute_error(y_test, y_pred)
            rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
            r2 = r2_score(y_test, y_pred)
            metrics = {"mae": mae, "rmse": rmse, "r2": r2}
            score = mae  # lower is better
            is_better = score < best_score
            LOGGER.info("    %s: MAE=%.4f RMSE=%.4f R²=%.4f", name, mae, rmse, r2)
        else:
            y_prob = pipeline.predict_proba(X_te)[:, 1]
            try:
                roc = roc_auc_score(y_test, y_prob)
            except ValueError:
                roc = 0.5
            try:
                pr_auc = average_precision_score(y_test, y_prob)
            except ValueError:
                pr_auc = 0.0
            y_pred_bin = (y_prob >= 0.5).astype(int)
            f1 = f1_score(y_test, y_pred_bin, zero_division=0)
            metrics = {"roc_auc": roc, "pr_auc": pr_auc, "f1": f1}
            score = roc  # higher is better
            is_better = score > best_score
            LOGGER.info("    %s: ROC_AUC=%.4f PR_AUC=%.4f F1=%.4f", name, roc, pr_auc, f1)

        if is_better:
            best_name = name
            best_pipeline = pipeline
            best_metrics = metrics
            best_score = score

    # Refit best model on all available data (train + test)
    X_all = pd.concat([X_train[feature_cols], X_test[feature_cols]], ignore_index=True)
    y_all = np.concatenate([y_train, y_test])
    assert best_pipeline is not None
    best_pipeline.fit(X_all, y_all)

    LOGGER.info("  ✓ Selected %s for %s", best_name, model_name)
    return best_name, best_pipeline, best_metrics


def train_lap_time_model(
    data_path: Path,
    cfg: StrategyFeatureConfig,
    circuit_info: pd.DataFrame | None = None,
) -> ModelResult:
    """Train the LapTimePerKM regression model."""
    LOGGER.info("═══ LapTimePerKM Model ═══")
    df = pd.read_csv(data_path)
    df = prepare_lap_time_data(df, circuit_info)

    if "LapTimePerKM" not in df.columns:
        raise ValueError("LapTimePerKM not computed – ensure CircuitInfo.csv has Length data")

    train, test = split_train_test(df, cfg)
    LOGGER.info("  Train: %d rows | Test: %d rows", len(train), len(test))

    target = "LapTimePerKM"
    best_name, pipeline, metrics = _train_and_compare(
        train, train[target].to_numpy(),
        test, test[target].to_numpy(),
        LAP_TIME_FEATURES_NUMERIC, LAP_TIME_FEATURES_CATEGORICAL,
        task="regression", model_name="lap_time",
    )

    return ModelResult(
        name="lap_time", model_type=best_name, pipeline=pipeline,
        metrics=metrics,
        feature_cols=LAP_TIME_FEATURES_NUMERIC + LAP_TIME_FEATURES_CATEGORICAL,
        numeric_cols=LAP_TIME_FEATURES_NUMERIC,
        categorical_cols=LAP_TIME_FEATURES_CATEGORICAL,
        target_col=target, task="regression",
    )


def train_pitstop_model(
    data_path: Path,
    cfg: StrategyFeatureConfig,
) -> ModelResult:
    """Train the PitstopT regression model."""
    LOGGER.info("═══ PitstopT Model ═══")
    df = pd.read_csv(data_path)
    df = prepare_pitstop_data(df)

    train, test = split_train_test(df, cfg)
    LOGGER.info("  Train: %d rows | Test: %d rows", len(train), len(test))

    target = "PitstopT"
    best_name, pipeline, metrics = _train_and_compare(
        train, train[target].to_numpy(),
        test, test[target].to_numpy(),
        PITSTOP_FEATURES_NUMERIC, PITSTOP_FEATURES_CATEGORICAL,
        task="regression", model_name="pitstop",
    )

    return ModelResult(
        name="pitstop", model_type=best_name, pipeline=pipeline,
        metrics=metrics,
        feature_cols=PITSTOP_FEATURES_NUMERIC + PITSTOP_FEATURES_CATEGORICAL,
        numeric_cols=PITSTOP_FEATURES_NUMERIC,
        categorical_cols=PITSTOP_FEATURES_CATEGORICAL,
        target_col=target, task="regression",
    )


def train_inlap_model(
    data_path: Path,
    cfg: StrategyFeatureConfig,
    circuit_info: pd.DataFrame | None = None,
) -> ModelResult:
    """Train the Inlap LapTimePerKM regression model."""
    LOGGER.info("═══ Inlap Model ═══")
    df = pd.read_csv(data_path)
    df = prepare_inlap_data(df, circuit_info)

    if "LapTimePerKM" not in df.columns:
        raise ValueError("LapTimePerKM not computed in Inlaps data")

    train, test = split_train_test(df, cfg)
    LOGGER.info("  Train: %d rows | Test: %d rows", len(train), len(test))

    target = "LapTimePerKM"
    best_name, pipeline, metrics = _train_and_compare(
        train, train[target].to_numpy(),
        test, test[target].to_numpy(),
        INLAP_FEATURES_NUMERIC, INLAP_FEATURES_CATEGORICAL,
        task="regression", model_name="inlap",
    )

    return ModelResult(
        name="inlap", model_type=best_name, pipeline=pipeline,
        metrics=metrics,
        feature_cols=INLAP_FEATURES_NUMERIC + INLAP_FEATURES_CATEGORICAL,
        numeric_cols=INLAP_FEATURES_NUMERIC,
        categorical_cols=INLAP_FEATURES_CATEGORICAL,
        target_col=target, task="regression",
    )


def train_outlap_model(
    data_path: Path,
    cfg: StrategyFeatureConfig,
    circuit_info: pd.DataFrame | None = None,
) -> ModelResult:
    """Train the Outlap LapTimePerKM regression model."""
    LOGGER.info("═══ Outlap Model ═══")
    df = pd.read_csv(data_path)
    df = prepare_outlap_data(df, circuit_info)

    if "LapTimePerKM" not in df.columns:
        raise ValueError("LapTimePerKM not computed in Outlaps data")

    train, test = split_train_test(df, cfg)
    LOGGER.info("  Train: %d rows | Test: %d rows", len(train), len(test))

    target = "LapTimePerKM"
    best_name, pipeline, metrics = _train_and_compare(
        train, train[target].to_numpy(),
        test, test[target].to_numpy(),
        OUTLAP_FEATURES_NUMERIC, OUTLAP_FEATURES_CATEGORICAL,
        task="regression", model_name="outlap",
    )

    return ModelResult(
        name="outlap", model_type=best_name, pipeline=pipeline,
        metrics=metrics,
        feature_cols=OUTLAP_FEATURES_NUMERIC + OUTLAP_FEATURES_CATEGORICAL,
        numeric_cols=OUTLAP_FEATURES_NUMERIC,
        categorical_cols=OUTLAP_FEATURES_CATEGORICAL,
        target_col=target, task="regression",
    )


def train_safety_car_model(
    data_path: Path,
    cfg: StrategyFeatureConfig,
) -> ModelResult:
    """Train the Safety Car classification model."""
    LOGGER.info("═══ Safety Car Model ═══")
    df = pd.read_csv(data_path)
    df = prepare_safety_car_data(df)

    train, test = split_train_test(df, cfg)
    LOGGER.info("  Train: %d rows | Test: %d rows", len(train), len(test))

    target = "SafetyCar"
    best_name, pipeline, metrics = _train_and_compare(
        train, train[target].to_numpy(),
        test, test[target].to_numpy(),
        SC_FEATURES_NUMERIC, SC_FEATURES_CATEGORICAL,
        task="classification", model_name="safety_car",
    )

    return ModelResult(
        name="safety_car", model_type=best_name, pipeline=pipeline,
        metrics=metrics,
        feature_cols=SC_FEATURES_NUMERIC + SC_FEATURES_CATEGORICAL,
        numeric_cols=SC_FEATURES_NUMERIC,
        categorical_cols=SC_FEATURES_CATEGORICAL,
        target_col=target, task="classification",
    )


def train_all_models(
    data_dir: Path,
    output_dir: Path,
    cfg: StrategyFeatureConfig | None = None,
) -> dict[str, ModelResult]:
    """Train all 5 strategy models and save artifacts."""
    if cfg is None:
        cfg = StrategyFeatureConfig()

    # Load circuit info for models that need it
    circuit_info_path = PATHS.project_root.parent / "CircuitInfo.csv"
    circuit_info = None
    if circuit_info_path.exists():
        circuit_info = pd.read_csv(circuit_info_path, index_col=0)

    results: dict[str, ModelResult] = {}

    # Train each model
    model_configs: list[tuple[str, str, Any]] = [
        ("lap_time", "DryQuickLaps.csv", lambda p: train_lap_time_model(p, cfg, circuit_info)),
        ("pitstop", "PitstopsWithTeams.csv", lambda p: train_pitstop_model(p, cfg)),
        ("inlap", "Inlaps.csv", lambda p: train_inlap_model(p, cfg, circuit_info)),
        ("outlap", "Outlaps.csv", lambda p: train_outlap_model(p, cfg, circuit_info)),
        ("safety_car", "SafetyCars.csv", lambda p: train_safety_car_model(p, cfg)),
    ]

    for name, csv_file, train_fn in model_configs:
        csv_path = data_dir / csv_file
        if not csv_path.exists():
            LOGGER.warning("Skipping %s model – data file not found: %s", name, csv_path)
            continue

        try:
            result = train_fn(csv_path)
            results[name] = result
        except Exception as e:
            LOGGER.error("Failed to train %s model: %s", name, e)
            continue

    # Save all artifacts
    output_dir.mkdir(parents=True, exist_ok=True)

    all_metrics: dict[str, Any] = {}
    for name, result in results.items():
        # Save model pipeline
        model_path = output_dir / f"{name}_model.joblib"
        joblib.dump({
            "pipeline": result.pipeline,
            "feature_cols": result.feature_cols,
            "numeric_cols": result.numeric_cols,
            "categorical_cols": result.categorical_cols,
            "target_col": result.target_col,
            "task": result.task,
            "model_type": result.model_type,
        }, model_path)
        LOGGER.info("Saved %s model to %s", name, model_path)

        all_metrics[name] = {
            "model_type": result.model_type,
            "task": result.task,
            **result.metrics,
        }

    # Save summary metrics
    write_json({
        "timestamp": datetime.now().isoformat(),
        "models": all_metrics,
    }, output_dir / "strategy_metrics.json")

    LOGGER.info("═══ All strategy models saved to %s ═══", output_dir)
    return results


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train F1 strategy models (RF vs GB)")
    parser.add_argument(
        "--data_dir", type=str,
        default=str(PATHS.data_processed),
        help="Directory containing CSV data files",
    )
    parser.add_argument(
        "--output_dir", type=str, default="",
        help="Output directory for model artifacts (default: artifacts/<timestamp>)",
    )
    parser.add_argument(
        "--train_years", nargs="+", type=int,
        default=[2019, 2020, 2021, 2022, 2023],
    )
    parser.add_argument(
        "--test_years", nargs="+", type=int,
        default=[2024],
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cfg = StrategyFeatureConfig(
        train_years=args.train_years,
        test_years=args.test_years,
    )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = Path(args.output_dir) if args.output_dir else PATHS.artifacts / f"strategy_{timestamp}"

    train_all_models(
        data_dir=Path(args.data_dir),
        output_dir=output_dir,
        cfg=cfg,
    )

    # Create/update latest symlink
    latest_link = PATHS.artifacts / "strategy_latest"
    if latest_link.exists() or latest_link.is_symlink():
        latest_link.unlink()
    latest_link.symlink_to(output_dir.resolve(), target_is_directory=True)


if __name__ == "__main__":
    main()
