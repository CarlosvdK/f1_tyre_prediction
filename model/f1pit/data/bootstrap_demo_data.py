from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from f1pit.config import PATHS, RANDOM_SEED
from f1pit.utils.io import ensure_dir
from f1pit.utils.logging import get_logger

LOGGER = get_logger(__name__)


@dataclass(frozen=True)
class DemoDataConfig:
    years: tuple[int, ...]
    races_per_year: int = 6
    drivers_per_race: int = 12
    random_seed: int = RANDOM_SEED
    output_dir: Path = PATHS.data_raw / "kaggle_f1"


def _format_lap_time(ms: int) -> str:
    minutes = ms // 60000
    seconds = (ms % 60000) / 1000.0
    return f"{minutes}:{seconds:06.3f}"


def _base_tables(rng: np.random.Generator) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    circuits = pd.DataFrame(
        [
            {"circuitId": 1, "circuitRef": "albert_park", "name": "Albert Park", "location": "Melbourne", "country": "Australia", "lat": -37.8497, "lng": 144.968, "alt": 10, "deg_base_ms": 86500, "deg_per_lap_ms": 42},
            {"circuitId": 2, "circuitRef": "bahrain", "name": "Bahrain International Circuit", "location": "Sakhir", "country": "Bahrain", "lat": 26.0325, "lng": 50.5106, "alt": 7, "deg_base_ms": 90000, "deg_per_lap_ms": 55},
            {"circuitId": 3, "circuitRef": "barcelona", "name": "Circuit de Barcelona-Catalunya", "location": "Barcelona", "country": "Spain", "lat": 41.57, "lng": 2.26111, "alt": 109, "deg_base_ms": 86000, "deg_per_lap_ms": 48},
            {"circuitId": 4, "circuitRef": "silverstone", "name": "Silverstone Circuit", "location": "Silverstone", "country": "UK", "lat": 52.0786, "lng": -1.01694, "alt": 153, "deg_base_ms": 87500, "deg_per_lap_ms": 50},
            {"circuitId": 5, "circuitRef": "monza", "name": "Autodromo Nazionale di Monza", "location": "Monza", "country": "Italy", "lat": 45.6156, "lng": 9.28111, "alt": 162, "deg_base_ms": 81000, "deg_per_lap_ms": 35},
            {"circuitId": 6, "circuitRef": "spa", "name": "Circuit de Spa-Francorchamps", "location": "Spa", "country": "Belgium", "lat": 50.4372, "lng": 5.97139, "alt": 401, "deg_base_ms": 104000, "deg_per_lap_ms": 44},
            {"circuitId": 7, "circuitRef": "suzuka", "name": "Suzuka Circuit", "location": "Suzuka", "country": "Japan", "lat": 34.8431, "lng": 136.541, "alt": 45, "deg_base_ms": 91500, "deg_per_lap_ms": 53},
            {"circuitId": 8, "circuitRef": "interlagos", "name": "Interlagos", "location": "Sao Paulo", "country": "Brazil", "lat": -23.7036, "lng": -46.6997, "alt": 785, "deg_base_ms": 72500, "deg_per_lap_ms": 41},
        ]
    )

    constructors = pd.DataFrame(
        [
            {"constructorId": i + 1, "constructorRef": f"constructor_{i + 1}", "name": f"Constructor {i + 1}", "nationality": "Unknown"}
            for i in range(10)
        ]
    )

    drivers = pd.DataFrame(
        [
            {
                "driverId": i + 1,
                "driverRef": f"driver_{i + 1}",
                "number": i + 1,
                "code": f"D{i + 1:02d}",
                "forename": f"Driver{i + 1}",
                "surname": "Demo",
                "dob": "1995-01-01",
                "nationality": "Unknown",
            }
            for i in range(20)
        ]
    )

    # Small perturbation to avoid perfectly regular synthetic worlds.
    circuits["deg_per_lap_ms"] = circuits["deg_per_lap_ms"] + rng.normal(0, 2, len(circuits))
    return circuits, constructors, drivers


def generate_demo_dataset(cfg: DemoDataConfig) -> Path:
    rng = np.random.default_rng(cfg.random_seed)
    ensure_dir(cfg.output_dir)

    circuits, constructors, drivers = _base_tables(rng)
    driver_ids = drivers["driverId"].tolist()
    constructor_ids = constructors["constructorId"].tolist()

    driver_skill = {d: float(rng.normal(0, 320)) for d in driver_ids}
    driver_aggression = {d: float(rng.normal(0, 1.0)) for d in driver_ids}
    constructor_strength = {c: float(rng.normal(0, 220)) for c in constructor_ids}
    driver_to_constructor = {d: constructor_ids[(d - 1) % len(constructor_ids)] for d in driver_ids}

    races_rows: list[dict] = []
    results_rows: list[dict] = []
    lap_rows: list[dict] = []
    pit_rows: list[dict] = []

    race_id = 1
    for year in cfg.years:
        for rnd in range(1, cfg.races_per_year + 1):
            circuit = circuits.iloc[(race_id - 1) % len(circuits)]
            race_laps = int(rng.integers(52, 63))
            races_rows.append(
                {
                    "raceId": race_id,
                    "year": int(year),
                    "round": int(rnd),
                    "circuitId": int(circuit["circuitId"]),
                    "name": f"Demo GP {year} R{rnd}",
                    "date": f"{year}-{((rnd - 1) % 12) + 1:02d}-15",
                    "time": "14:00:00Z",
                    "url": "https://example.com/demo-race",
                }
            )

            field = rng.choice(driver_ids, size=cfg.drivers_per_race, replace=False).tolist()
            grid_perm = rng.permutation(np.arange(1, cfg.drivers_per_race + 1))
            grid_by_driver = {d: int(g) for d, g in zip(field, grid_perm)}
            total_time_by_driver: dict[int, float] = {}
            race_lap_rows: list[dict] = []

            for driver in field:
                constructor_id = driver_to_constructor[driver]
                base_ms = float(circuit["deg_base_ms"])
                deg_per_lap = float(circuit["deg_per_lap_ms"]) + rng.normal(0, 1.8)

                n_stops = 2 if rng.random() < 0.8 else 3
                ideal_stint = race_laps / (n_stops + 1)
                pit_laps: list[int] = []
                previous_pit = 2
                for s in range(n_stops):
                    center = int(round((s + 1) * ideal_stint + 0.9 * driver_aggression[driver] + rng.normal(0, 1.8)))
                    remaining_stops = n_stops - s - 1
                    low = previous_pit + 8
                    high = race_laps - (remaining_stops + 1) * 8
                    pit_lap = int(np.clip(center, low, high))
                    pit_laps.append(pit_lap)
                    previous_pit = pit_lap
                pit_set = set(pit_laps)

                race_total_ms = 0.0
                stint_start = 1
                stop_counter = 0

                for lap in range(1, race_laps + 1):
                    tyre_age = max(0, lap - stint_start)
                    non_linear_deg = tyre_age * deg_per_lap + (tyre_age ** 1.35) * 2.2
                    race_phase = 100.0 * np.sin((lap / race_laps) * np.pi)
                    pace_offset = driver_skill[driver] + constructor_strength[constructor_id]
                    noise = float(rng.normal(0, 360))

                    lap_ms = base_ms + pace_offset + non_linear_deg + race_phase + noise

                    if lap in pit_set:
                        stop_counter += 1
                        lap_ms += float(rng.normal(2300, 250))  # in-lap pace loss
                        pit_ms = int(np.clip(rng.normal(22500 + 300 * stop_counter, 1300), 18000, 30000))
                        pit_rows.append(
                            {
                                "raceId": race_id,
                                "driverId": driver,
                                "stop": stop_counter,
                                "lap": lap,
                                "time": "00:00:00",
                                "duration": f"{pit_ms / 1000.0:.3f}",
                                "milliseconds": pit_ms,
                            }
                        )
                        race_total_ms += pit_ms * 0.12
                        stint_start = lap + 1
                    elif lap == stint_start and lap > 1:
                        lap_ms += float(rng.normal(1500, 220))  # out-lap penalty

                    lap_ms = max(60000.0, lap_ms)
                    race_total_ms += lap_ms
                    race_lap_rows.append(
                        {
                            "raceId": race_id,
                            "driverId": driver,
                            "lap": lap,
                            "milliseconds": int(lap_ms),
                        }
                    )

                total_time_by_driver[driver] = race_total_ms

            lap_df_race = pd.DataFrame(race_lap_rows)
            lap_df_race["position"] = (
                lap_df_race.groupby("lap")["milliseconds"].rank(method="dense", ascending=True).astype(int)
            )
            lap_df_race["time"] = lap_df_race["milliseconds"].map(_format_lap_time)
            lap_rows.extend(lap_df_race.to_dict(orient="records"))

            ordered = sorted(total_time_by_driver.items(), key=lambda kv: kv[1])
            for pos_order, (driver, _) in enumerate(ordered, start=1):
                results_rows.append(
                    {
                        "raceId": race_id,
                        "driverId": int(driver),
                        "constructorId": int(driver_to_constructor[driver]),
                        "grid": int(grid_by_driver[driver]),
                        "positionOrder": int(pos_order),
                        "laps": int(race_laps),
                    }
                )

            race_id += 1

    races_df = pd.DataFrame(races_rows)
    results_df = pd.DataFrame(results_rows)
    lap_df = pd.DataFrame(lap_rows)
    pit_df = pd.DataFrame(pit_rows)

    races_df.to_csv(cfg.output_dir / "races.csv", index=False)
    results_df.to_csv(cfg.output_dir / "results.csv", index=False)
    lap_df.to_csv(cfg.output_dir / "lap_times.csv", index=False)
    pit_df.to_csv(cfg.output_dir / "pit_stops.csv", index=False)
    constructors.to_csv(cfg.output_dir / "constructors.csv", index=False)
    drivers.to_csv(cfg.output_dir / "drivers.csv", index=False)
    circuits.drop(columns=["deg_base_ms", "deg_per_lap_ms"]).to_csv(cfg.output_dir / "circuits.csv", index=False)

    # Let build_tables resolve this directory as a Kaggle-like source.
    ensure_dir(PATHS.data_raw)
    (PATHS.data_raw / "kaggle_path.txt").write_text(str(cfg.output_dir.resolve()), encoding="utf-8")

    LOGGER.info(
        "Demo dataset created at %s | races=%s laps=%s pit_stops=%s",
        cfg.output_dir,
        len(races_df),
        len(lap_df),
        len(pit_df),
    )
    return cfg.output_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create offline demo F1 CSV tables compatible with the pipeline.")
    parser.add_argument("--years", nargs="+", type=int, default=[2018, 2019, 2020])
    parser.add_argument("--races_per_year", type=int, default=6)
    parser.add_argument("--drivers_per_race", type=int, default=12)
    parser.add_argument("--seed", type=int, default=RANDOM_SEED)
    parser.add_argument("--output_dir", type=str, default=str(PATHS.data_raw / "kaggle_f1"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    generate_demo_dataset(
        DemoDataConfig(
            years=tuple(args.years),
            races_per_year=args.races_per_year,
            drivers_per_race=args.drivers_per_race,
            random_seed=args.seed,
            output_dir=Path(args.output_dir),
        )
    )


if __name__ == "__main__":
    main()
