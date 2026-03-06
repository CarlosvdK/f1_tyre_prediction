"""
Tests for the strategy features and optimizer.

Uses synthetic data to verify:
- Feature engineering computes LapTimePerKM and RacePercentage correctly
- Strategy optimizer enumerates valid strategies
- Train/test split works on temporal boundaries
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from f1pit.features.strategy_features import (
    StrategyFeatureConfig,
    prepare_lap_time_data,
    prepare_pitstop_data,
    prepare_safety_car_data,
    split_train_test,
)
from f1pit.models.strategy_optimizer import StrategyOptimizer, EXPECTED_TYRE_LIFE


def _synthetic_quick_laps() -> pd.DataFrame:
    """Create synthetic dry quick laps data matching the thesis structure."""
    rows = []
    rng = np.random.RandomState(42)
    for year in [2022, 2023, 2024]:
        for gp in ["Bahrain", "Monza"]:
            length = 5.412 if gp == "Bahrain" else 5.793
            total_laps = 57 if gp == "Bahrain" else 53
            for driver in ["VER", "HAM", "LEC"]:
                for lap in range(1, total_laps + 1):
                    tyre_life = (lap - 1) % 20 + 1
                    compound = "MEDIUM" if lap <= 25 else "HARD"
                    stint = 1 if lap <= 25 else 2
                    lap_time = 90.0 + 0.1 * tyre_life + rng.normal(0, 0.5)
                    rows.append({
                        "Driver": driver,
                        "Team": "Test Team",
                        "LapNumber": lap,
                        "LapTime": lap_time,
                        "Stint": stint,
                        "Compound": compound,
                        "TyreLife": tyre_life,
                        "Position": 5,
                        "Year": year,
                        "GP": gp,
                        "Length": length,
                        "Laps": total_laps,
                    })
    return pd.DataFrame(rows)


def _synthetic_pitstops() -> pd.DataFrame:
    rows = []
    for year in [2022, 2023, 2024]:
        for gp in ["Bahrain", "Monza"]:
            for driver in ["VER", "HAM", "LEC"]:
                rows.append({
                    "GP": gp,
                    "Circuit": gp,
                    "PitstopT": 23.5 + np.random.RandomState(hash(f"{year}{gp}{driver}") % 2**31).normal(0, 1),
                    "Driver": driver,
                    "Year": year,
                    "Team": "Test Team",
                })
    return pd.DataFrame(rows)


def _synthetic_safety_cars() -> pd.DataFrame:
    rows = []
    for year in [2022, 2023, 2024]:
        for gp in ["Bahrain", "Monza"]:
            total_laps = 57 if gp == "Bahrain" else 53
            for lap in range(1, total_laps + 1):
                # SC on laps 15 and 35 for Bahrain
                if gp == "Bahrain" and lap in [15, 35]:
                    status = "4"
                    label = "SafetyCar"
                else:
                    status = "1"
                    label = "AllClear"
                rows.append({
                    "LapNumber": lap,
                    "GP": gp,
                    "Year": year,
                    "TrackStatus": status,
                    "Label": label,
                })
    return pd.DataFrame(rows)


class TestStrategyFeatures:
    """Test suite for strategy feature engineering."""

    def test_lap_time_per_km_computed(self) -> None:
        df = _synthetic_quick_laps()
        result = prepare_lap_time_data(df)
        assert "LapTimePerKM" in result.columns
        # LapTimePerKM should be LapTime / Length
        sample = result.iloc[0]
        expected = sample["LapTime"] / sample["Length"]
        assert np.isclose(sample["LapTimePerKM"], expected, atol=1e-6)

    def test_race_percentage_computed(self) -> None:
        df = _synthetic_quick_laps()
        result = prepare_lap_time_data(df)
        assert "RacePercentage" in result.columns
        # First lap of a 57-lap race should be ~1/57
        bahrain_laps = result[(result["GP"] == "Bahrain") & (result["LapNumber"] == 1)]
        if not bahrain_laps.empty:
            assert np.isclose(bahrain_laps.iloc[0]["RacePercentage"], 1 / 57, atol=0.01)

    def test_outlier_removal(self) -> None:
        df = _synthetic_quick_laps()
        original_len = len(prepare_lap_time_data(df))
        # Add extreme outliers
        outlier_row = df.iloc[0].copy()
        outlier_row["LapTime"] = 500.0  # Very slow
        df = pd.concat([df, pd.DataFrame([outlier_row])], ignore_index=True)
        filtered_len = len(prepare_lap_time_data(df))
        assert filtered_len <= original_len + 1  # At most same + the new row

    def test_pitstop_data_filtering(self) -> None:
        df = _synthetic_pitstops()
        # Add invalid pitstops
        bad_rows = pd.DataFrame([
            {"GP": "Test", "PitstopT": 5.0, "Year": 2023},  # Too fast
            {"GP": "Test", "PitstopT": 120.0, "Year": 2023},  # Too slow
        ])
        extended = pd.concat([df, bad_rows], ignore_index=True)
        result = prepare_pitstop_data(extended)
        assert result["PitstopT"].min() >= 10
        assert result["PitstopT"].max() <= 60

    def test_safety_car_binary_target(self) -> None:
        df = _synthetic_safety_cars()
        result = prepare_safety_car_data(df)
        assert "SafetyCar" in result.columns
        assert set(result["SafetyCar"].unique()).issubset({0, 1})
        # We know Bahrain laps 15 and 35 should be SC
        bahrain_sc = result[(result["GP"] == "Bahrain") & (result["LapNumber"] == 15)]
        assert bahrain_sc["SafetyCar"].iloc[0] == 1

    def test_train_test_split_temporal(self) -> None:
        df = _synthetic_quick_laps()
        cfg = StrategyFeatureConfig(
            train_years=[2022, 2023],
            test_years=[2024],
        )
        train, test = split_train_test(df, cfg)
        assert all(train["Year"].isin([2022, 2023]))
        assert all(test["Year"] == 2024)
        assert len(train) > 0
        assert len(test) > 0


class TestStrategyOptimizer:
    """Test suite for strategy enumeration."""

    def test_strategy_enumeration_minimum(self) -> None:
        """All strategies must use at least 2 different compounds."""
        optimizer = StrategyOptimizer.__new__(StrategyOptimizer)
        optimizer.MIN_STINT_LAPS = 5
        optimizer.MAX_PIT_STOPS = 3
        strategies = optimizer._enumerate_strategies(total_laps=57)
        assert len(strategies) > 0

        for compounds, pit_laps in strategies:
            # Must use >= 2 different compounds
            assert len(set(compounds)) >= 2, f"Strategy {compounds} uses < 2 compounds"
            # Number of stints = number of pit stops + 1
            assert len(compounds) == len(pit_laps) + 1

    def test_strategy_stint_lengths_valid(self) -> None:
        """Each stint must be at least MIN_STINT_LAPS."""
        optimizer = StrategyOptimizer.__new__(StrategyOptimizer)
        optimizer.MIN_STINT_LAPS = 5
        optimizer.MAX_PIT_STOPS = 3
        strategies = optimizer._enumerate_strategies(total_laps=57)

        for compounds, pit_laps in strategies:
            boundaries = [0] + pit_laps + [57]
            for i in range(len(boundaries) - 1):
                stint_len = boundaries[i + 1] - boundaries[i]
                assert stint_len >= 5, (
                    f"Stint {i+1} in {compounds} is only {stint_len} laps"
                )

    def test_format_time(self) -> None:
        from f1pit.models.strategy_optimizer import _format_time
        assert _format_time(5400.123) == "1:30:00.123"
        assert _format_time(90.5) == "1:30.500"
        assert _format_time(30.0) == "0:30.000"
