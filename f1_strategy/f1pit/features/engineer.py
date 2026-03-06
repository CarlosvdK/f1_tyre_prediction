from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from f1pit.config import DEFAULT_K_PIT, DEFAULT_MAX_CAP


@dataclass
class FeatureBuildConfig:
    k_pit: int = DEFAULT_K_PIT
    max_cap: int = DEFAULT_MAX_CAP
    task: str = "classification"  # classification | regression


def _next_pit_labels(group: pd.DataFrame, k_pit: int, max_cap: int) -> pd.DataFrame:
    pit_laps = np.sort(group.loc[group["pit_lap_flag"] == 1, "lap_number"].dropna().astype(int).unique())
    laps = group["lap_number"].astype(int).to_numpy()

    next_pit = np.full_like(laps, fill_value=-1)
    pit_soon = np.zeros_like(laps)
    laps_to_pit = np.full_like(laps, fill_value=-1)

    if pit_laps.size > 0:
        idx = np.searchsorted(pit_laps, laps, side="left")
        valid = idx < pit_laps.size
        next_pit[valid] = pit_laps[idx[valid]]
        laps_to_pit[valid] = next_pit[valid] - laps[valid]
        pit_soon = ((laps_to_pit >= 0) & (laps_to_pit <= k_pit)).astype(int)

    out = group.copy()
    out["next_pit_lap"] = np.where(next_pit >= 0, next_pit, np.nan)
    out["laps_to_pit"] = np.where(laps_to_pit >= 0, laps_to_pit, np.nan)
    out["pit_soon"] = pit_soon

    # Final-lap region after the last pit does not support the pit-window decision.
    if pit_laps.size > 0:
        out = out[out["lap_number"] <= pit_laps.max()].copy()

    out["laps_to_pit"] = out["laps_to_pit"].clip(upper=max_cap)
    return out


def _stint_features(group: pd.DataFrame) -> pd.DataFrame:
    g = group.sort_values("lap_number").copy()

    # Use only pit history up to previous lap; current-lap pit is outcome-adjacent.
    prior_pits = g["pit_lap_flag"].shift(1, fill_value=0).astype(int)
    g["stint_number"] = prior_pits.cumsum() + 1

    last_pit_marker = np.where(g["pit_lap_flag"] == 1, g["lap_number"], np.nan)
    g["last_pit_lap"] = pd.Series(last_pit_marker, index=g.index).shift(1).ffill().fillna(0)
    g["laps_since_last_pit"] = g["lap_number"] - g["last_pit_lap"]

    # All rolling pace features must use only previous laps to avoid future leakage.
    prior_lap_times = g["lap_time_seconds"].shift(1)
    g["rolling_mean_lap_time_last_3"] = prior_lap_times.rolling(window=3, min_periods=1).mean()
    g["rolling_mean_lap_time_last_5"] = prior_lap_times.rolling(window=5, min_periods=1).mean()
    g["rolling_std_lap_time_last_5"] = prior_lap_times.rolling(window=5, min_periods=2).std()
    g["lap_time_delta_prev_lap"] = g["lap_time_seconds"] - prior_lap_times
    g["lap_time_delta_from_rolling_mean_last_3"] = g["lap_time_seconds"] - g["rolling_mean_lap_time_last_3"]

    # Stint-local personal best must come from previous laps only.
    g["best_lap_in_stint_so_far"] = prior_lap_times.groupby(g["stint_number"]).cummin()
    g["lap_time_delta_from_personal_best_in_stint"] = g["lap_time_seconds"] - g["best_lap_in_stint_so_far"]

    # Pseudo-telemetry proxy: trend in recent pace deterioration/improvement.
    g["rolling_mean_slope_last_3"] = g["rolling_mean_lap_time_last_3"].diff()

    return g


def build_supervised_table(lap_df: pd.DataFrame, cfg: FeatureBuildConfig) -> pd.DataFrame:
    required = {"race_id", "driver_id", "lap_number", "lap_time_seconds", "pit_lap_flag"}
    missing = required - set(lap_df.columns)
    if missing:
        raise ValueError(f"Missing required columns for feature engineering: {sorted(missing)}")

    df = lap_df.copy()
    df = df.sort_values(["race_id", "driver_id", "lap_number"]).reset_index(drop=True)

    labelled_parts = []
    for _, g in df.groupby(["race_id", "driver_id"], sort=False):
        labelled_parts.append(_next_pit_labels(g, cfg.k_pit, cfg.max_cap))
    labelled = pd.concat(labelled_parts, ignore_index=True) if labelled_parts else df.iloc[0:0].copy()

    feat_parts = []
    for _, g in labelled.groupby(["race_id", "driver_id"], sort=False):
        feat_parts.append(_stint_features(g))
    feats = pd.concat(feat_parts, ignore_index=True) if feat_parts else labelled.iloc[0:0].copy()

    feats["lap_number_norm"] = feats["lap_number"] / feats["race_total_laps"].replace({0: np.nan})
    feats["lap_number_norm"] = feats["lap_number_norm"].fillna(0.0)
    feats["laps_remaining"] = (feats["race_total_laps"] - feats["lap_number"]).clip(lower=0)
    feats["laps_remaining_norm"] = feats["laps_remaining"] / feats["race_total_laps"].replace({0: np.nan})
    feats["laps_remaining_norm"] = feats["laps_remaining_norm"].fillna(0.0)
    feats["pit_count_so_far"] = (feats["stint_number"] - 1).clip(lower=0)

    # Keep feature surface robust across eras.
    for col in [
        "track_position",
        "lap_time_rank_in_lap",
        "lap_field_size",
        "lap_time_rank_pct",
        "year",
        "circuit_id",
        "country",
        "constructor_id",
        "grid",
    ]:
        if col not in feats.columns:
            feats[col] = np.nan

    feats = feats.replace([np.inf, -np.inf], np.nan)

    if cfg.task == "classification":
        feats["target"] = feats["pit_soon"].astype(int)
        feats = feats.dropna(subset=["target"]).copy()
    elif cfg.task == "regression":
        feats["target"] = feats["laps_to_pit"]
        feats = feats.dropna(subset=["target"]).copy()
    else:
        raise ValueError("task must be one of: classification, regression")

    return feats


def default_feature_columns() -> tuple[list[str], list[str]]:
    numeric = [
        "lap_number",
        "lap_number_norm",
        "laps_remaining",
        "laps_remaining_norm",
        "lap_time_seconds",
        "rolling_mean_lap_time_last_3",
        "rolling_mean_lap_time_last_5",
        "rolling_std_lap_time_last_5",
        "rolling_mean_slope_last_3",
        "lap_time_delta_prev_lap",
        "lap_time_delta_from_rolling_mean_last_3",
        "lap_time_delta_from_personal_best_in_stint",
        "laps_since_last_pit",
        "last_pit_lap",
        "stint_number",
        "pit_count_so_far",
        "track_position",
        "lap_time_rank_in_lap",
        "lap_field_size",
        "lap_time_rank_pct",
        "lat",
        "long",
        "grid",
        "ergast_lat",
        "ergast_long",
    ]
    categorical = ["year", "circuit_id", "country", "ergast_country", "constructor_id"]
    return numeric, categorical
