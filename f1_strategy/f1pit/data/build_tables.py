from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from f1pit.config import PATHS
from f1pit.utils.io import save_parquet
from f1pit.utils.logging import get_logger

LOGGER = get_logger(__name__)


REQUIRED_FILES = [
    "lap_times.csv",
    "pit_stops.csv",
    "races.csv",
    "results.csv",
    "constructors.csv",
    "drivers.csv",
    "circuits.csv",
]


def resolve_kaggle_dir(explicit_path: str | None = None) -> Path:
    if explicit_path:
        return Path(explicit_path)

    local_copy = PATHS.data_raw / "kaggle_f1"
    if local_copy.exists():
        return local_copy

    marker = PATHS.data_raw / "kaggle_path.txt"
    if marker.exists():
        return Path(marker.read_text(encoding="utf-8").strip())

    raise FileNotFoundError(
        "Could not resolve Kaggle dataset path. Run python -m f1pit.data.download_kaggle first."
    )


def load_csvs(dataset_dir: Path) -> dict[str, pd.DataFrame]:
    tables: dict[str, pd.DataFrame] = {}
    for filename in REQUIRED_FILES:
        fpath = dataset_dir / filename
        if not fpath.exists():
            raise FileNotFoundError(f"Missing required file: {fpath}")
        tables[filename.replace(".csv", "")] = pd.read_csv(fpath)
    return tables


def _safe_to_numeric(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    for col in cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def _ergast_race_meta(years: list[int]) -> pd.DataFrame:
    rows = []
    for year in years:
        cache_file = PATHS.ergast_cache / f"races_{year}.json"
        if not cache_file.exists():
            continue
        with cache_file.open("r", encoding="utf-8") as f:
            payload = json.load(f)
        race_table = payload.get("MRData", {}).get("RaceTable", {})
        races = race_table.get("Races", [])
        for r in races:
            circuit = r.get("Circuit", {})
            location = circuit.get("Location", {})
            rows.append(
                {
                    "year": int(r.get("season", year)),
                    "round": int(r.get("round", np.nan)),
                    "ergast_circuit_id": circuit.get("circuitId"),
                    "ergast_country": location.get("country"),
                    "ergast_lat": pd.to_numeric(location.get("lat"), errors="coerce"),
                    "ergast_long": pd.to_numeric(location.get("long"), errors="coerce"),
                }
            )
    return pd.DataFrame(rows)


def build_lap_level_table(
    years: list[int] | None = None,
    use_ergast: bool = False,
    small: bool = False,
    kaggle_path: str | None = None,
) -> pd.DataFrame:
    dataset_dir = resolve_kaggle_dir(kaggle_path)
    tables = load_csvs(dataset_dir)

    lap_times = tables["lap_times"]
    pit_stops = tables["pit_stops"]
    races = tables["races"]
    results = tables["results"]
    circuits = tables["circuits"]

    races = _safe_to_numeric(races, ["raceId", "year", "round", "circuitId"])
    lap_times = _safe_to_numeric(lap_times, ["raceId", "driverId", "lap", "position", "milliseconds"])
    pit_stops = _safe_to_numeric(pit_stops, ["raceId", "driverId", "lap", "milliseconds"])
    results = _safe_to_numeric(results, ["raceId", "driverId", "constructorId", "grid", "positionOrder", "laps"])
    circuits = _safe_to_numeric(circuits, ["circuitId", "lat", "lng", "alt"])

    races = races.rename(columns={"raceId": "race_id", "circuitId": "circuit_id"})
    lap_times = lap_times.rename(
        columns={
            "raceId": "race_id",
            "driverId": "driver_id",
            "lap": "lap_number",
            "position": "track_position",
            "milliseconds": "lap_time_ms",
        }
    )
    pit_stops = pit_stops.rename(columns={"raceId": "race_id", "driverId": "driver_id", "lap": "pit_lap"})
    results = results.rename(columns={"raceId": "race_id", "driverId": "driver_id", "constructorId": "constructor_id"})
    circuits = circuits.rename(columns={"circuitId": "circuit_id", "lng": "long"})

    if years:
        races = races[races["year"].isin(years)].copy()

    if small:
        selected_year = int(races["year"].dropna().max())
        races = races[races["year"] == selected_year].sort_values("round").head(4).copy()
        LOGGER.info("Small mode enabled: using year=%s with %s races", selected_year, len(races))

    race_ids = set(races["race_id"].dropna().astype(int).tolist())
    lap_times = lap_times[lap_times["race_id"].isin(race_ids)].copy()
    pit_stops = pit_stops[pit_stops["race_id"].isin(race_ids)].copy()
    results = results[results["race_id"].isin(race_ids)].copy()

    race_laps = results.groupby("race_id", dropna=False)["laps"].max().rename("race_total_laps").reset_index()

    pit_flags = (
        pit_stops[["race_id", "driver_id", "pit_lap"]]
        .dropna()
        .drop_duplicates()
        .assign(pit_lap_flag=1)
        .rename(columns={"pit_lap": "lap_number"})
    )

    lap = lap_times.merge(races[["race_id", "year", "round", "name", "date", "circuit_id"]], on="race_id", how="left")
    lap = lap.merge(results[["race_id", "driver_id", "constructor_id", "grid", "positionOrder"]], on=["race_id", "driver_id"], how="left")
    lap = lap.merge(circuits[["circuit_id", "name", "location", "country", "lat", "long"]], on="circuit_id", how="left", suffixes=("", "_circuit"))
    lap = lap.merge(race_laps, on="race_id", how="left")
    lap = lap.merge(pit_flags, on=["race_id", "driver_id", "lap_number"], how="left")
    lap["pit_lap_flag"] = lap["pit_lap_flag"].fillna(0).astype(int)

    lap["lap_time_seconds"] = lap["lap_time_ms"] / 1000.0
    lap["lap_time_rank_in_lap"] = lap.groupby(["race_id", "lap_number"])["lap_time_seconds"].rank(method="dense")
    lap["lap_field_size"] = lap.groupby(["race_id", "lap_number"])["driver_id"].transform("nunique")
    lap["lap_time_rank_pct"] = lap["lap_time_rank_in_lap"] / lap["lap_field_size"].replace({0: np.nan})
    lap["lap_time_rank_pct"] = lap["lap_time_rank_pct"].fillna(1.0)
    lap = lap.sort_values(["race_id", "driver_id", "lap_number"]).reset_index(drop=True)

    if use_ergast:
        years_in_table = sorted(lap["year"].dropna().astype(int).unique().tolist())
        ergast_meta = _ergast_race_meta(years_in_table)
        if not ergast_meta.empty:
            lap = lap.merge(ergast_meta, on=["year", "round"], how="left")
        else:
            LOGGER.warning("--use_ergast=1 but no local cache found in %s", PATHS.ergast_cache)

    return lap


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build unified lap-level table from Kaggle F1 CSVs")
    parser.add_argument("--years", nargs="*", type=int, default=None)
    parser.add_argument("--use_ergast", type=int, default=0, choices=[0, 1])
    parser.add_argument("--small", type=int, default=0, choices=[0, 1])
    parser.add_argument("--kaggle_path", type=str, default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    df = build_lap_level_table(
        years=args.years,
        use_ergast=bool(args.use_ergast),
        small=bool(args.small),
        kaggle_path=args.kaggle_path,
    )
    output_path = PATHS.data_processed / "lap_level.parquet"
    save_parquet(df, output_path)
    LOGGER.info("Saved processed table to %s | rows=%s cols=%s", output_path, len(df), len(df.columns))


if __name__ == "__main__":
    main()
