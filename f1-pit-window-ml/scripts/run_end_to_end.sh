#!/usr/bin/env bash
set -euo pipefail

export PYTHONPATH=src
export MPLCONFIGDIR="${MPLCONFIGDIR:-/tmp/matplotlib-cache}"
mkdir -p "${MPLCONFIGDIR}"

SMALL="${SMALL:-0}"
YEARS="${YEARS:-2018 2019}"
K_PIT="${K_PIT:-3}"
MODE="${MODE:-groupkfold}"

python -m f1pit.data.download_kaggle --copy_csvs 1
python -m f1pit.data.fetch_ergast --year 2019
python -m f1pit.data.build_tables --years ${YEARS} --use_ergast 1 --small "${SMALL}"
python -m f1pit.models.train --k_pit "${K_PIT}" --mode "${MODE}" --small "${SMALL}"
python -m f1pit.models.evaluate --artifact_dir artifacts/latest
