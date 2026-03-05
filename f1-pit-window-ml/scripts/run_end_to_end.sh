#!/usr/bin/env bash
set -euo pipefail

export PYTHONPATH=src
export MPLCONFIGDIR="${MPLCONFIGDIR:-/tmp/matplotlib-cache}"
mkdir -p "${MPLCONFIGDIR}"

SMALL="${SMALL:-0}"
YEARS="${YEARS:-2018 2019 2020}"
K_PIT="${K_PIT:-3}"
MODE="${MODE:-groupkfold}"
HOLDOUT_YEAR="${HOLDOUT_YEAR:-2020}"

python -m f1pit.data.download_kaggle --copy_csvs 1
for year in ${YEARS}; do
  python -m f1pit.data.fetch_ergast --year "${year}"
done
python -m f1pit.data.build_tables --years ${YEARS} --use_ergast 1 --small "${SMALL}"
python -m f1pit.models.train --k_pit "${K_PIT}" --mode "${MODE}" --holdout_year "${HOLDOUT_YEAR}" --small "${SMALL}"
python -m f1pit.models.evaluate --artifact_dir artifacts/latest
