from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Paths:
    project_root: Path = Path(__file__).resolve().parents[2]
    data_raw: Path = project_root / "data" / "raw"
    data_processed: Path = project_root / "data" / "processed"
    ergast_cache: Path = data_raw / "ergast_cache"
    artifacts: Path = project_root / "artifacts"


RANDOM_SEED = 42
DEFAULT_K_PIT = 3
DEFAULT_MAX_CAP = 25

PATHS = Paths()
