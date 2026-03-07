"""
Fetch per-lap telemetry (x, y, speed, brake, throttle) from FastF1.

For each circuit we store:
  - A reference track outline from the fastest lap
  - Sample laps at different tyre ages to visualise degradation features

Output: data/processed/telemetry.parquet
"""
from __future__ import annotations

import argparse
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

from f1pit.config import PATHS
from f1pit.utils.logging import get_logger

LOGGER = get_logger(__name__)
warnings.filterwarnings("ignore", category=FutureWarning)

DRY_COMPOUNDS = {"SOFT", "MEDIUM", "HARD"}


def _extract_telemetry(lap) -> pd.DataFrame | None:
    """Get car telemetry for a single lap, return as DataFrame."""
    try:
        tel = lap.get_telemetry()
    except Exception:
        return None
    if tel is None or tel.empty:
        return None

    cols = {}
    if "X" in tel.columns and "Y" in tel.columns:
        cols["x"] = tel["X"].values.astype(float)
        cols["y"] = tel["Y"].values.astype(float)
    else:
        return None  # no positional data

    cols["speed"] = tel["Speed"].values.astype(float) if "Speed" in tel.columns else np.zeros(len(tel))
    cols["brake"] = tel["Brake"].astype(float).values if "Brake" in tel.columns else np.zeros(len(tel))
    cols["throttle"] = (tel["Throttle"].values.astype(float) / 100.0) if "Throttle" in tel.columns else np.zeros(len(tel))

    df = pd.DataFrame(cols)
    # Drop rows with NaN positions
    df = df.dropna(subset=["x", "y"])
    return df if len(df) > 20 else None


def fetch_circuit_telemetry(
    year: int,
    gp_name: str | int,
    cache_dir: Path | None = None,
    max_sample_laps: int = 6,
) -> list[dict]:
    """Fetch telemetry for a single race. Returns list of row dicts."""
    import fastf1

    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
        fastf1.Cache.enable_cache(str(cache_dir))

    try:
        session = fastf1.get_session(year, gp_name, "R")
        session.load(telemetry=True, weather=False, messages=False)
    except Exception as e:
        LOGGER.warning("Failed to load %s %s: %s", year, gp_name, e)
        return []

    laps = session.laps
    if laps.empty:
        return []

    # Filter to dry compounds only
    compounds = set(laps["Compound"].dropna().str.upper().unique())
    if compounds & {"WET", "INTERMEDIATE"}:
        LOGGER.info("Skipping %s %s (wet race)", year, gp_name)
        return []

    event_name = session.event["EventName"] if hasattr(session, "event") else str(gp_name)
    circuit_key = event_name.replace(" Grand Prix", "").strip()
    total_laps = int(laps["LapNumber"].max())

    rows = []

    # --- 1. Reference lap (fastest) for track outline ---
    quick = laps.pick_quicklaps(1.07)
    if not quick.empty:
        fastest = quick.pick_fastest()
        if fastest is not None:
            tel_df = _extract_telemetry(fastest)
            if tel_df is not None:
                for _, pt in tel_df.iterrows():
                    rows.append({
                        "circuit": circuit_key,
                        "year": year,
                        "driver": str(fastest["Driver"]),
                        "lap_number": int(fastest["LapNumber"]),
                        "compound": str(fastest["Compound"]).upper(),
                        "tyre_life": int(fastest["TyreLife"]) if pd.notna(fastest.get("TyreLife")) else 0,
                        "lap_type": "reference",
                        "x": pt["x"],
                        "y": pt["y"],
                        "speed": pt["speed"],
                        "brake": pt["brake"],
                        "throttle": pt["throttle"],
                    })
                LOGGER.info("  ✓ Reference lap: %s L%s", fastest["Driver"], fastest["LapNumber"])

    # --- 2. Sample laps: early stint vs late stint for degradation ---
    sampled = 0
    for driver in laps["Driver"].unique():
        if sampled >= max_sample_laps:
            break
        driver_laps = laps[
            (laps["Driver"] == driver)
            & (laps["Compound"].str.upper().isin(DRY_COMPOUNDS))
        ].sort_values("LapNumber")

        if driver_laps.empty:
            continue

        # Pick longest stint
        longest_stint = driver_laps.groupby("Stint").size().idxmax()
        stint_laps = driver_laps[driver_laps["Stint"] == longest_stint].sort_values("LapNumber")

        if len(stint_laps) < 6:
            continue

        # Early stint lap (2nd lap of stint to avoid outlap effects)
        early_lap = stint_laps.iloc[1] if len(stint_laps) > 1 else stint_laps.iloc[0]
        # Late stint lap (2nd to last)
        late_lap = stint_laps.iloc[-2] if len(stint_laps) > 2 else stint_laps.iloc[-1]

        for lap, lap_type in [(early_lap, "early_stint"), (late_lap, "late_stint")]:
            tel_df = _extract_telemetry(lap)
            if tel_df is None:
                continue
            compound = str(lap["Compound"]).upper()
            tyre_life = int(lap["TyreLife"]) if pd.notna(lap.get("TyreLife")) else 0
            for _, pt in tel_df.iterrows():
                rows.append({
                    "circuit": circuit_key,
                    "year": year,
                    "driver": str(lap["Driver"]),
                    "lap_number": int(lap["LapNumber"]),
                    "compound": compound,
                    "tyre_life": tyre_life,
                    "lap_type": lap_type,
                    "x": pt["x"],
                    "y": pt["y"],
                    "speed": pt["speed"],
                    "brake": pt["brake"],
                    "throttle": pt["throttle"],
                })
            sampled += 1

    LOGGER.info("  → %s: %d telemetry points from %d laps", circuit_key, len(rows), sampled + 1)
    return rows


def fetch_all_telemetry(
    years: list[int],
    output_path: Path,
    cache_dir: Path | None = None,
) -> None:
    """Fetch telemetry for all races in given years and save to parquet."""
    import fastf1

    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
        fastf1.Cache.enable_cache(str(cache_dir))

    all_rows: list[dict] = []

    for year in years:
        LOGGER.info("═══ Fetching telemetry for %s ═══", year)
        try:
            schedule = fastf1.get_event_schedule(year, include_testing=False)
        except Exception as e:
            LOGGER.warning("Could not get schedule for %s: %s", year, e)
            continue

        race_events = schedule[schedule["EventFormat"].isin(
            ["conventional", "sprint_shootout", "sprint_qualifying", "sprint"]
        )]
        if race_events.empty:
            race_events = schedule[schedule["Session5"] == "Race"]
        if race_events.empty:
            race_events = schedule

        for _, event in race_events.iterrows():
            round_num = int(event.get("RoundNumber", 0))
            if round_num == 0:
                continue
            event_name = event.get("EventName", f"Round {round_num}")
            LOGGER.info("  → %s R%s: %s", year, round_num, event_name)

            rows = fetch_circuit_telemetry(year, round_num, cache_dir)
            all_rows.extend(rows)

    if not all_rows:
        LOGGER.warning("No telemetry data collected!")
        return

    df = pd.DataFrame(all_rows)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(output_path, index=False)
    LOGGER.info("Saved %s: %d rows, %d circuits", output_path, len(df), df["circuit"].nunique())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch F1 telemetry data via FastF1")
    parser.add_argument(
        "--years", nargs="+", type=int,
        default=[2023, 2024],
        help="Seasons to fetch (default: 2023-2024)",
    )
    parser.add_argument(
        "--output", type=str,
        default=str(PATHS.data_processed / "telemetry.parquet"),
        help="Output parquet file path",
    )
    parser.add_argument(
        "--cache_dir", type=str,
        default=str(PATHS.data_raw / "fastf1_cache"),
        help="FastF1 cache directory",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    fetch_all_telemetry(
        years=args.years,
        output_path=Path(args.output),
        cache_dir=Path(args.cache_dir),
    )


if __name__ == "__main__":
    main()
