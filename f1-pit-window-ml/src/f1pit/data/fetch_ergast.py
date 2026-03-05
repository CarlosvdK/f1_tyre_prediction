from __future__ import annotations

import argparse
import json
from pathlib import Path

import requests

from f1pit.config import PATHS
from f1pit.utils.io import ensure_dir
from f1pit.utils.logging import get_logger

LOGGER = get_logger(__name__)


DEFAULT_BASE_URL = "https://api.jolpi.ca/ergast/f1"


def fetch_races_for_year(year: int, base_url: str = DEFAULT_BASE_URL, timeout: int = 30) -> dict:
    url = f"{base_url}/{year}.json"
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    return response.json()


def cache_payload(payload: dict, output_path: Path) -> None:
    ensure_dir(output_path.parent)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch Ergast-compatible race metadata and cache JSON")
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--base_url", type=str, default=DEFAULT_BASE_URL)
    parser.add_argument("--force", type=int, default=0, choices=[0, 1])
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cache_file = PATHS.ergast_cache / f"races_{args.year}.json"

    if cache_file.exists() and not bool(args.force):
        LOGGER.info("Using existing cache: %s", cache_file)
        return

    payload = fetch_races_for_year(args.year, base_url=args.base_url)
    cache_payload(payload, cache_file)
    LOGGER.info("Cached Ergast data at %s", cache_file)


if __name__ == "__main__":
    main()
