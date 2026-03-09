"""
Feature engineering for thesis-style strategy models.

Computes LapTimePerKM, RacePercentage, and prepares features
for the regression and classification models.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd


@dataclass
class StrategyFeatureConfig:
    """Configuration for strategy feature engineering."""
    train_years: list[int] = field(default_factory=lambda: [2019, 2020, 2021, 2022, 2023])
    test_years: list[int] = field(default_factory=lambda: [2024])


# ── Feature definitions for each model ──────────────────────────────────

LAP_TIME_FEATURES_NUMERIC = [
    "RacePercentage",
    "TyreLife",
    "Position",
    "Stint",
]

LAP_TIME_FEATURES_CATEGORICAL = [
    "GP",
    "Driver",
    "Team",
    "Compound",
]

PITSTOP_FEATURES_NUMERIC: list[str] = []
PITSTOP_FEATURES_CATEGORICAL = ["GP"]

INLAP_FEATURES_NUMERIC = ["TyreLife", "Stint", "Position", "RacePercentage"]
INLAP_FEATURES_CATEGORICAL = ["GP", "Compound"]

OUTLAP_FEATURES_NUMERIC = ["Stint", "Position", "RacePercentage"]
OUTLAP_FEATURES_CATEGORICAL = ["GP", "Compound"]

SC_FEATURES_NUMERIC = ["LapNumber"]
SC_FEATURES_CATEGORICAL = ["GP"]


GP_NAME_MAP = {
    "australian": "australia",
    "austrian": "austria",
    "belgian": "belgium",
    "brazilian": "brazil",
    "british": "great britain",
    "canadian": "canada",
    "chinese": "china",
    "dutch": "netherlands",
    "emilia romagna": "imola",
    "french": "france",
    "hungarian": "hungary",
    "italian": "monza",
    "japanese": "japan",
    "mexican": "mexico",
    "mexico city": "mexico",
    "portuguese": "portugal",
    "russian": "russia",
    "saudi arabian": "saudi arabia",
    "spanish": "spain",
    "são paulo": "brazil",
    "tuscan": "monza",
    "las vegas": "las vegas",
    "united states": "austin",
    "70th anniversary": "70th",
    "styrian": "styria",
}


def _normalize_gp(name: str) -> str:
    """Normalize a Grand Prix name to match CircuitInfo convention."""
    key = name.replace("Grand Prix", "").strip().lower()
    return GP_NAME_MAP.get(key, key)


def prepare_lap_time_data(
    df: pd.DataFrame,
    circuit_info: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """
    Prepare DryQuickLaps data for the LapTimePerKM regression model.

    Required columns: Driver, Team, LapNumber, LapTime, Stint,
                      Compound, TyreLife, Position, Year, GP, Laps
    """
    out = df.copy()

    # Compute LapTimePerKM – need circuit Length
    # Drop any all-NaN Length/LapTimePerKM columns from a prior broken merge
    for col in ["Length", "LapTimePerKM"]:
        if col in out.columns and out[col].isna().all():
            out = out.drop(columns=[col])

    if "LapTimePerKM" not in out.columns:
        # Merge circuit info using normalized GP names
        if "Length" not in out.columns and circuit_info is not None and not circuit_info.empty:
            ci = circuit_info[["GP", "Length"]].drop_duplicates()
            out["_gp_key"] = out["GP"].apply(_normalize_gp)
            ci["_gp_key"] = ci["GP"].str.strip().str.lower()
            out = out.merge(ci[["_gp_key", "Length"]], on="_gp_key", how="left", suffixes=("", "_ci"))
            out = out.drop(columns=["_gp_key"], errors="ignore")

        if "Length" in out.columns:
            out["LapTimePerKM"] = out["LapTime"] / out["Length"]

    # Compute RacePercentage
    if "RacePercentage" not in out.columns and "Laps" in out.columns:
        out["RacePercentage"] = out["LapNumber"] / out["Laps"]

    # Ensure numeric types
    for col in ["LapTime", "LapTimePerKM", "RacePercentage", "TyreLife", "Position", "Stint", "LapNumber"]:
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce")

    # Drop rows without a target
    if "LapTimePerKM" in out.columns:
        out = out.dropna(subset=["LapTimePerKM"]).copy()

    # Remove extreme outliers (> 3 IQR)
    if "LapTimePerKM" in out.columns and len(out) > 100:
        q1 = out["LapTimePerKM"].quantile(0.01)
        q3 = out["LapTimePerKM"].quantile(0.99)
        out = out[(out["LapTimePerKM"] >= q1) & (out["LapTimePerKM"] <= q3)].copy()

    return out


def prepare_pitstop_data(df: pd.DataFrame) -> pd.DataFrame:
    """
    Prepare PitstopsWithTeams data for PitstopT regression model.

    Required columns: GP, PitstopT, Year
    """
    out = df.copy()
    out["PitstopT"] = pd.to_numeric(out["PitstopT"], errors="coerce")
    out = out.dropna(subset=["PitstopT"]).copy()

    # Remove abnormal pitstops (> 60s or < 10s  → likely issues or penalties)
    out = out[(out["PitstopT"] >= 10) & (out["PitstopT"] <= 60)].copy()

    return out


def prepare_inlap_data(
    df: pd.DataFrame,
    circuit_info: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Prepare Inlaps data for LapTimePerKM regression."""
    return prepare_lap_time_data(df, circuit_info)


def prepare_outlap_data(
    df: pd.DataFrame,
    circuit_info: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Prepare Outlaps data for LapTimePerKM regression."""
    return prepare_lap_time_data(df, circuit_info)


def prepare_safety_car_data(df: pd.DataFrame) -> pd.DataFrame:
    """
    Prepare SafetyCars data for binary classification.

    Target: 1 if SafetyCar (status 4) or VSC (status 6), else 0.
    """
    out = df.copy()
    out["LapNumber"] = pd.to_numeric(out["LapNumber"], errors="coerce")

    # Binary target: SC or VSC
    if "TrackStatus" in out.columns:
        out["SafetyCar"] = out["TrackStatus"].astype(str).isin(["4", "6"]).astype(int)
    elif "Label" in out.columns:
        out["SafetyCar"] = out["Label"].isin(["SafetyCar", "VSC"]).astype(int)
    else:
        out["SafetyCar"] = 0

    out = out.dropna(subset=["LapNumber"]).copy()
    return out


def split_train_test(
    df: pd.DataFrame,
    cfg: StrategyFeatureConfig,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split data into train (2019-2023) and test (2024) sets."""
    if "Year" not in df.columns:
        raise ValueError("DataFrame must have a 'Year' column for temporal split")

    train = df[df["Year"].isin(cfg.train_years)].copy()
    test = df[df["Year"].isin(cfg.test_years)].copy()
    return train, test
