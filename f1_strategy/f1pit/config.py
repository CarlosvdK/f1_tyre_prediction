from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Paths:
    # model/f1pit/config.py → parents[1] = model/, parents[2] = repo root
    repo_root: Path = Path(__file__).resolve().parents[2]
    model_root: Path = Path(__file__).resolve().parents[1]

    # Data lives at repo root level
    data_raw: Path = repo_root / "data" / "raw"
    data_processed: Path = repo_root / "data" / "processed"
    data_circuit_info: Path = repo_root / "data" / "CircuitInfo.csv"
    ergast_cache: Path = data_raw / "ergast_cache"

    # Artifacts and model outputs live under model/
    artifacts: Path = model_root / "artifacts"

    # For backwards compatibility
    project_root: Path = repo_root


RANDOM_SEED = 42
DEFAULT_K_PIT = 3
DEFAULT_MAX_CAP = 25

PATHS = Paths()

