"""
Fetch F1 race data using the FastF1 library.

Extracts lap times, stints, strategies, pitstops, inlaps, outlaps,
safety cars, and race metadata for 2019-2024.
Outputs CSV files to data/processed/ matching the thesis data structure.
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

# Suppress noisy FastF1 / urllib3 warnings
warnings.filterwarnings("ignore", category=FutureWarning)

# ── Circuit schedule: (year, round) pairs we know had dry races ──────────
# We fetch all races and filter wet ones post-hoc by checking for
# WET / INTERMEDIATE compound usage.

DRY_COMPOUNDS = {"SOFT", "MEDIUM", "HARD"}
WET_COMPOUNDS = {"WET", "INTERMEDIATE"}

# Expected tyre life (laps) per compound – rough Pirelli estimates
EXPECTED_TYRE_LIFE = {"SOFT": 18, "MEDIUM": 28, "HARD": 40}


def _load_circuit_info() -> pd.DataFrame:
    """Load CircuitInfo.csv from project root."""
    path = PATHS.project_root.parent / "CircuitInfo.csv"
    if not path.exists():
        # Fallback: try inside data/processed
        path = PATHS.data_processed / "CircuitInfo.csv"
    if not path.exists():
        LOGGER.warning("CircuitInfo.csv not found at %s – circuit features will be empty", path)
        return pd.DataFrame()
    df = pd.read_csv(path, index_col=0)
    return df


def _is_dry_race(laps_df: pd.DataFrame) -> bool:
    """Check if a race was entirely dry by inspecting tyre compounds."""
    if laps_df.empty:
        return False
    compounds = set(laps_df["Compound"].dropna().str.upper().unique())
    return len(compounds & WET_COMPOUNDS) == 0


def _apply_107_rule(laps_df: pd.DataFrame) -> pd.DataFrame:
    """Keep only laps within 107% of the fastest lap time."""
    if laps_df.empty or "LapTime" not in laps_df.columns:
        return laps_df

    # Convert timedelta to seconds if needed
    lt = laps_df["LapTime"].copy()
    if hasattr(lt.iloc[0], "total_seconds"):
        lt = lt.dt.total_seconds()
    else:
        lt = pd.to_numeric(lt, errors="coerce")

    fastest = lt.min()
    if pd.isna(fastest) or fastest <= 0:
        return laps_df
    threshold = fastest * 1.07
    mask = lt <= threshold
    return laps_df[mask].copy()


def fetch_race_data(
    year: int,
    gp_name: str | int,
    cache_dir: Path | None = None,
) -> dict[str, pd.DataFrame] | None:
    """
    Fetch a single race session from FastF1 and return structured DataFrames.

    Returns None if the race was wet or data is unavailable.
    """
    import fastf1

    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
        fastf1.Cache.enable_cache(str(cache_dir))

    try:
        session = fastf1.get_session(year, gp_name, "R")
        session.load(telemetry=False, weather=False, messages=False)
    except Exception as e:
        LOGGER.warning("Failed to load %s %s Race: %s", year, gp_name, e)
        return None

    laps = session.laps
    if laps.empty:
        LOGGER.warning("No lap data for %s %s", year, gp_name)
        return None

    # Check if race was dry
    if not _is_dry_race(laps):
        LOGGER.info("Skipping %s %s (wet race)", year, gp_name)
        return None

    # ── Derive GP name and total laps ──
    event_name = session.event["EventName"] if hasattr(session, "event") else str(gp_name)
    total_laps = int(laps["LapNumber"].max())

    # ── Base lap dataframe ──
    base_cols = [
        "Driver", "Team", "LapNumber", "LapTime", "Stint",
        "Compound", "TyreLife", "Position",
        "PitInTime", "PitOutTime",
    ]
    available_cols = [c for c in base_cols if c in laps.columns]
    df = laps[available_cols].copy()

    # Convert LapTime to seconds
    if "LapTime" in df.columns:
        if hasattr(df["LapTime"].iloc[0], "total_seconds"):
            df["LapTime"] = df["LapTime"].dt.total_seconds()
        else:
            df["LapTime"] = pd.to_numeric(df["LapTime"], errors="coerce")

    # Convert PitInTime/PitOutTime to detect inlaps/outlaps
    for col in ["PitInTime", "PitOutTime"]:
        if col in df.columns and hasattr(df[col].dropna().iloc[0] if not df[col].dropna().empty else None, "total_seconds"):
            pass  # keep as-is, we only check notna()

    df["Year"] = year
    df["GP"] = event_name
    df["Laps"] = total_laps
    df["Compound"] = df["Compound"].str.upper()

    # Standardize compound names
    compound_map = {
        "SOFT": "SOFT", "MEDIUM": "MEDIUM", "HARD": "HARD",
        "ULTRASOFT": "SOFT", "HYPERSOFT": "SOFT", "SUPERSOFT": "SOFT",
        "SUPERHARD": "HARD",
    }
    df["Compound"] = df["Compound"].map(compound_map).fillna(df["Compound"])

    # Filter to dry compounds only
    df = df[df["Compound"].isin(DRY_COMPOUNDS)].copy()

    # ── RacePercentage ──
    df["RacePercentage"] = df["LapNumber"] / total_laps

    # ── Identify inlaps and outlaps ──
    is_inlap = df["PitInTime"].notna() if "PitInTime" in df.columns else pd.Series(False, index=df.index)
    is_outlap = df["PitOutTime"].notna() if "PitOutTime" in df.columns else pd.Series(False, index=df.index)

    # ── Quick laps: not inlaps or outlaps, 107% rule ──
    quick_mask = (~is_inlap) & (~is_outlap) & df["LapTime"].notna()
    quick_laps = _apply_107_rule(df[quick_mask].copy())

    # ── Inlaps ──
    inlaps = df[is_inlap & df["LapTime"].notna()].copy()

    # ── Outlaps ──
    outlaps = df[is_outlap & df["LapTime"].notna()].copy()

    # ── Stints ──
    stint_data = []
    for driver, grp in df.groupby("Driver", sort=False):
        grp = grp.sort_values("LapNumber")
        for stint_num, stint_grp in grp.groupby("Stint", sort=True):
            compound = stint_grp["Compound"].mode()
            compound = compound.iloc[0] if not compound.empty else "UNKNOWN"
            stint_data.append({
                "Driver": driver,
                "Stint": int(stint_num),
                "Compound": compound,
                "GP": event_name,
                "Year": year,
                "StintLength": len(stint_grp),
            })
    stints_df = pd.DataFrame(stint_data) if stint_data else pd.DataFrame()

    # ── Strategy ──
    strategy_data = []
    for driver, grp in df.groupby("Driver", sort=False):
        grp = grp.sort_values("LapNumber")
        stint_compounds = []
        for stint_num, stint_grp in grp.groupby("Stint", sort=True):
            compound = stint_grp["Compound"].mode()
            compound = compound.iloc[0] if not compound.empty else "UNKNOWN"
            stint_len = len(stint_grp)
            stint_compounds.append((compound, stint_len, int(stint_num)))

        strategy_str = "-".join(c for c, _, _ in stint_compounds)
        pit_stops = max(0, len(stint_compounds) - 1)

        for compound, stint_len, stint_num in stint_compounds:
            strategy_data.append({
                "Year": year,
                "GP": event_name,
                "Driver": driver,
                "Strategy": strategy_str,
                "PitStops": pit_stops,
                "Stint": f"Stint {stint_num}",
                "Compound": compound,
                "StintLength": stint_len,
                "StintNumber": stint_num,
            })
    strategy_df = pd.DataFrame(strategy_data) if strategy_data else pd.DataFrame()

    # ── Pitstops ──
    pitstop_data = []
    if hasattr(session, "laps"):
        for driver, grp in laps.groupby("Driver", sort=False):
            pit_in_laps = grp[grp["PitInTime"].notna()].sort_values("LapNumber")
            for _, row in pit_in_laps.iterrows():
                pit_out_next = grp[
                    (grp["PitOutTime"].notna()) & (grp["LapNumber"] == row["LapNumber"] + 1)
                ]
                if not pit_out_next.empty:
                    pit_in_t = row["PitInTime"]
                    pit_out_t = pit_out_next.iloc[0]["PitOutTime"]
                    if hasattr(pit_in_t, "total_seconds") and hasattr(pit_out_t, "total_seconds"):
                        duration = (pit_out_t - pit_in_t).total_seconds()
                    else:
                        duration = np.nan
                else:
                    duration = np.nan

                team = row.get("Team", "Unknown")
                pitstop_data.append({
                    "GP": event_name,
                    "Circuit": event_name,
                    "PitstopT": duration if pd.notna(duration) and duration > 0 else np.nan,
                    "Driver": driver,
                    "Year": year,
                    "Team": team,
                })
    pitstop_df = pd.DataFrame(pitstop_data) if pitstop_data else pd.DataFrame()

    # ── Safety Cars ──
    sc_data = []
    if hasattr(session, "track_status") and session.track_status is not None and not session.track_status.empty:
        ts = session.track_status
        # Map track status codes to labels
        status_labels = {
            "1": "AllClear",
            "2": "Yellow",
            "4": "SafetyCar",
            "5": "Red",
            "6": "VSC",
            "7": "VSCEnding",
        }

        # For each lap, determine the track status
        for lap_num in range(1, total_laps + 1):
            # Find track status entries during this lap
            # Simplified: use the most severe status during the lap
            sc_data.append({
                "LapNumber": lap_num,
                "GP": event_name,
                "Year": year,
                "TrackStatus": "1",  # Default: all clear
                "Label": "AllClear",
            })

        # Override with actual track status from session data
        if "Status" in ts.columns:
            for _, row in ts.iterrows():
                status_code = str(row.get("Status", "1"))
                label = status_labels.get(status_code, f"Status_{status_code}")
                # We can't perfectly map status to lap without telemetry timing,
                # but we record all status changes
                if status_code in ("4", "6"):  # SC or VSC
                    # Estimate lap number from time if available
                    pass

    # Better approach: iterate laps and check track status
    sc_data = []
    for lap_num in range(1, total_laps + 1):
        lap_rows = laps[laps["LapNumber"] == lap_num]
        if lap_rows.empty:
            continue
        # Check if any TrackStatus column exists
        track_status = "1"
        label = "AllClear"
        if "TrackStatus" in lap_rows.columns:
            statuses = lap_rows["TrackStatus"].dropna().unique()
            for s in statuses:
                s_str = str(s)
                if "4" in s_str:
                    track_status = "4"
                    label = "SafetyCar"
                    break
                elif "6" in s_str:
                    track_status = "6"
                    label = "VSC"
                    break
                elif "2" in s_str:
                    track_status = "2"
                    label = "Yellow"

        sc_data.append({
            "LapNumber": lap_num,
            "GP": event_name,
            "Year": year,
            "TrackStatus": track_status,
            "Label": label,
        })
    safety_cars_df = pd.DataFrame(sc_data) if sc_data else pd.DataFrame()

    # ── NLaps ──
    nlaps_df = pd.DataFrame([{"GP": event_name, "Year": year, "Laps": total_laps}])

    # Clean up columns we don't want downstream
    drop_cols = ["PitInTime", "PitOutTime"]
    for c in drop_cols:
        if c in quick_laps.columns:
            quick_laps = quick_laps.drop(columns=[c])
        if c in inlaps.columns:
            inlaps = inlaps.drop(columns=[c])
        if c in outlaps.columns:
            outlaps = outlaps.drop(columns=[c])

    return {
        "quick_laps": quick_laps,
        "stints": stints_df,
        "strategy": strategy_df,
        "inlaps": inlaps,
        "outlaps": outlaps,
        "pitstops": pitstop_df,
        "safety_cars": safety_cars_df,
        "nlaps": nlaps_df,
    }


def _merge_circuit_info(df: pd.DataFrame, circuit_info: pd.DataFrame) -> pd.DataFrame:
    """Merge circuit characteristics into a laps-like DataFrame."""
    if circuit_info.empty or "GP" not in df.columns:
        return df

    # Build a fuzzy GP-to-circuit-row mapping
    ci = circuit_info.copy()
    ci["GP_key"] = ci["GP"].str.strip().str.lower()
    df["GP_key"] = df["GP"].str.strip().str.lower()

    # Also try partial matching
    merge_cols = [c for c in ci.columns if c not in ("GP_key",)]
    merged = df.merge(ci[merge_cols + ["GP_key"]], on="GP_key", how="left", suffixes=("", "_ci"))
    merged = merged.drop(columns=["GP_key"], errors="ignore")

    # Compute LapTimePerKM if Length is available
    if "Length" in merged.columns and "LapTime" in merged.columns:
        merged["LapTimePerKM"] = merged["LapTime"] / merged["Length"]

    return merged


def fetch_all_seasons(
    years: list[int],
    output_dir: Path,
    cache_dir: Path | None = None,
) -> None:
    """Fetch data for multiple seasons and save to CSV."""
    import fastf1

    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
        fastf1.Cache.enable_cache(str(cache_dir))

    circuit_info = _load_circuit_info()

    all_quick_laps = []
    all_stints = []
    all_strategies = []
    all_inlaps = []
    all_outlaps = []
    all_pitstops = []
    all_safety_cars = []
    all_nlaps = []

    for year in years:
        LOGGER.info("═══ Fetching %s season ═══", year)
        try:
            schedule = fastf1.get_event_schedule(year, include_testing=False)
        except Exception as e:
            LOGGER.warning("Could not get schedule for %s: %s", year, e)
            continue

        # Filter to race events only
        race_events = schedule[schedule["EventFormat"].isin(["conventional", "sprint_shootout", "sprint_qualifying", "sprint"])]
        if race_events.empty:
            race_events = schedule[schedule["Session5"] == "Race"]
        if race_events.empty:
            race_events = schedule

        for _, event in race_events.iterrows():
            round_num = int(event.get("RoundNumber", 0))
            event_name = event.get("EventName", f"Round {round_num}")
            if round_num == 0:
                continue

            LOGGER.info("  → %s Round %s: %s", year, round_num, event_name)

            result = fetch_race_data(year, round_num, cache_dir)
            if result is None:
                continue

            # Merge circuit info into lap-level data
            for key in ("quick_laps", "inlaps", "outlaps"):
                if not result[key].empty:
                    result[key] = _merge_circuit_info(result[key], circuit_info)

            all_quick_laps.append(result["quick_laps"])
            all_stints.append(result["stints"])
            all_strategies.append(result["strategy"])
            all_inlaps.append(result["inlaps"])
            all_outlaps.append(result["outlaps"])
            all_pitstops.append(result["pitstops"])
            all_safety_cars.append(result["safety_cars"])
            all_nlaps.append(result["nlaps"])

    # ── Save CSVs ──
    output_dir.mkdir(parents=True, exist_ok=True)

    def _concat_save(parts: list[pd.DataFrame], filename: str) -> None:
        if parts:
            combined = pd.concat(parts, ignore_index=True)
            combined = combined.loc[:, ~combined.columns.duplicated()]
            path = output_dir / filename
            combined.to_csv(path, index=False)
            LOGGER.info("Saved %s: %s rows × %s cols", filename, len(combined), len(combined.columns))
        else:
            LOGGER.warning("No data for %s", filename)

    _concat_save(all_quick_laps, "DryQuickLaps.csv")
    _concat_save(all_stints, "Stints.csv")
    _concat_save(all_strategies, "Strategyfull.csv")
    _concat_save(all_inlaps, "Inlaps.csv")
    _concat_save(all_outlaps, "Outlaps.csv")
    _concat_save(all_pitstops, "PitstopsWithTeams.csv")
    _concat_save(all_safety_cars, "SafetyCars.csv")
    _concat_save(all_nlaps, "NLaps.csv")

    LOGGER.info("All CSVs saved to %s", output_dir)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract F1 race data using FastF1")
    parser.add_argument(
        "--years", nargs="+", type=int,
        default=[2019, 2020, 2021, 2022, 2023, 2024],
        help="Seasons to extract (default: 2019-2024)",
    )
    parser.add_argument(
        "--output_dir", type=str,
        default=str(PATHS.data_processed),
        help="Directory to save CSV files",
    )
    parser.add_argument(
        "--cache_dir", type=str,
        default=str(PATHS.data_raw / "fastf1_cache"),
        help="FastF1 cache directory",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    fetch_all_seasons(
        years=args.years,
        output_dir=Path(args.output_dir),
        cache_dir=Path(args.cache_dir),
    )


if __name__ == "__main__":
    main()
