from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import kagglehub

from f1pit.config import PATHS
from f1pit.utils.logging import get_logger

LOGGER = get_logger(__name__)


def download_dataset(copy_csvs: bool = True) -> Path:
    # Required snippet from project specification.
    path = kagglehub.dataset_download("rohanrao/formula-1-world-championship-1950-2020")
    print("Path to dataset files:", path)

    source = Path(path)
    PATHS.data_raw.mkdir(parents=True, exist_ok=True)
    (PATHS.data_raw / "kaggle_path.txt").write_text(str(source), encoding="utf-8")

    if copy_csvs:
        target = PATHS.data_raw / "kaggle_f1"
        target.mkdir(parents=True, exist_ok=True)
        csv_files = [
            "lap_times.csv",
            "pit_stops.csv",
            "races.csv",
            "results.csv",
            "constructors.csv",
            "drivers.csv",
            "circuits.csv",
        ]
        for filename in csv_files:
            src_file = source / filename
            if src_file.exists():
                shutil.copy2(src_file, target / filename)
            else:
                LOGGER.warning("Missing expected file in Kaggle folder: %s", src_file)

    return source


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download Kaggle F1 dataset with kagglehub")
    parser.add_argument("--copy_csvs", type=int, default=1, choices=[0, 1])
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    download_dataset(copy_csvs=bool(args.copy_csvs))


if __name__ == "__main__":
    main()
