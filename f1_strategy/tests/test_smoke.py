from __future__ import annotations

import numpy as np
import pandas as pd

from f1pit.features.engineer import FeatureBuildConfig, build_supervised_table


def _synthetic_lap_table() -> pd.DataFrame:
    rows = []
    for race_id in [1, 2]:
        for driver_id in [10, 20]:
            for lap in range(1, 16):
                pit = 1 if lap in [6, 12] else 0
                rows.append(
                    {
                        "race_id": race_id,
                        "driver_id": driver_id,
                        "lap_number": lap,
                        "pit_lap_flag": pit,
                        "lap_time_seconds": 80.0 + 0.2 * lap + np.random.RandomState(race_id + driver_id + lap).rand(),
                        "race_total_laps": 15,
                        "year": 2019,
                        "circuit_id": 3,
                        "country": "Testland",
                        "track_position": 5,
                        "lap_time_rank_in_lap": 7,
                        "lat": 1.0,
                        "long": 2.0,
                    }
                )
    return pd.DataFrame(rows)


def test_feature_builder_smoke() -> None:
    df = _synthetic_lap_table()
    out = build_supervised_table(df, FeatureBuildConfig(k_pit=3, task="classification"))

    assert len(out) > 0
    assert "target" in out.columns
    assert set(out["target"].dropna().unique()).issubset({0, 1})
    assert "laps_since_last_pit" in out.columns
    assert "lap_time_delta_prev_lap" in out.columns

    grp = out[(out["race_id"] == 1) & (out["driver_id"] == 10)].sort_values("lap_number").reset_index(drop=True)
    lap1 = float(grp.loc[0, "lap_time_seconds"])
    rolling_at_lap2 = float(grp.loc[1, "rolling_mean_lap_time_last_3"])
    assert np.isclose(rolling_at_lap2, lap1, atol=1e-8)
