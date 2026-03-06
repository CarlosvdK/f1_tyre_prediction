#!/usr/bin/env bash
set -euo pipefail

export PYTHONPATH=src
export MPLCONFIGDIR="${MPLCONFIGDIR:-/tmp/matplotlib-cache}"
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-1}"
export OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-1}"
export MKL_NUM_THREADS="${MKL_NUM_THREADS:-1}"
export NUMEXPR_NUM_THREADS="${NUMEXPR_NUM_THREADS:-1}"
mkdir -p "${MPLCONFIGDIR}"

SMALL="${SMALL:-0}"
YEARS="${YEARS:-2018 2019 2020}"
K_PIT="${K_PIT:-3}"
MODE="${MODE:-groupkfold}"
HOLDOUT_YEAR="${HOLDOUT_YEAR:-2020}"
DATA_MODE="${DATA_MODE:-auto}"  # auto | live | demo
USE_ERGAST="${USE_ERGAST:-1}"
ERGAST_FLAG="${USE_ERGAST}"
TRAIN_SAFE_MODELS="${TRAIN_SAFE_MODELS:-0}"

prepare_demo_data() {
  python -m f1pit.data.bootstrap_demo_data --years ${YEARS}
  ERGAST_FLAG=0
}

if [ "${DATA_MODE}" = "demo" ]; then
  prepare_demo_data
elif [ "${DATA_MODE}" = "fastf1" ]; then
  echo "═══ Using FastF1 pipeline ═══"
  python -m f1pit.data.fetch_fastf1 --years ${YEARS}
  python -m f1pit.models.strategy_models --data_dir data/processed --train_years 2019 2020 2021 2022 2023 --test_years 2024
  echo "═══ FastF1 pipeline complete ═══"
  exit 0
elif [ "${DATA_MODE}" = "live" ]; then
  python -m f1pit.data.download_kaggle --copy_csvs 1
  if [ "${ERGAST_FLAG}" = "1" ]; then
    for year in ${YEARS}; do
      python -m f1pit.data.fetch_ergast --year "${year}"
    done
  fi
else
  if python -m f1pit.data.download_kaggle --copy_csvs 1; then
    if [ "${ERGAST_FLAG}" = "1" ]; then
      for year in ${YEARS}; do
        if ! python -m f1pit.data.fetch_ergast --year "${year}"; then
          echo "Ergast fetch failed; continuing with --use_ergast 0."
          ERGAST_FLAG=0
          break
        fi
      done
    fi
  else
    echo "Live dataset download failed; falling back to demo dataset."
    prepare_demo_data
  fi
fi

python -m f1pit.data.build_tables --years ${YEARS} --use_ergast "${ERGAST_FLAG}" --small "${SMALL}"
python -m f1pit.models.train --k_pit "${K_PIT}" --mode "${MODE}" --holdout_year "${HOLDOUT_YEAR}" --safe_models "${TRAIN_SAFE_MODELS}" --small "${SMALL}"
python -m f1pit.models.evaluate --artifact_dir artifacts/latest
