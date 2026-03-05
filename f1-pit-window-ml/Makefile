PYTHONPATH := src

.PHONY: download ergast build train eval e2e test

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
	PYTHONPATH=$(PYTHONPATH) python -m pytest -q
