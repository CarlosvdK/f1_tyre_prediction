PYTHONPATH := .

.PHONY: download ergast build train eval e2e test fastf1-fetch strategy-train strategy-optimize serve

download:
	PYTHONPATH=$(PYTHONPATH) python -m f1pit.data.download_kaggle --copy_csvs 1

ergast:
	PYTHONPATH=$(PYTHONPATH) python -m f1pit.data.fetch_ergast --year 2019

build:
	PYTHONPATH=$(PYTHONPATH) python -m f1pit.data.build_tables --years 2018 2019 --use_ergast 1 --small 1

train:
	PYTHONPATH=$(PYTHONPATH) python -m f1pit.models.train --k_pit 3 --mode groupkfold --small 1

eval:
	PYTHONPATH=$(PYTHONPATH) python -m f1pit.models.evaluate --artifact_dir artifacts/latest

e2e:
	bash scripts/run_end_to_end.sh

test:
	PYTHONPATH=$(PYTHONPATH) python -m pytest tests/ -q

fastf1-fetch:
	PYTHONPATH=$(PYTHONPATH) python -m f1pit.data.fetch_fastf1 --years 2019 2020 2021 2022 2023 2024

strategy-train:
	PYTHONPATH=$(PYTHONPATH) python -m f1pit.models.strategy_models

strategy-optimize:
	PYTHONPATH=$(PYTHONPATH) python -m f1pit.models.strategy_optimizer --gp Bahrain --total_laps 57

serve:
	PYTHONPATH=$(PYTHONPATH) uvicorn f1pit.api.server:app --host 127.0.0.1 --port 8000
