---
description: How to extract F1 race data using FastF1 API
---

# FastF1 Data Extraction

## Overview
Extracts F1 race data (2019-2024) using the FastF1 library and generates 8 CSV files in `data/processed/`.

## Prerequisites
- Python 3.10+ with `fastf1>=3.3.0` installed
- Working directory: `model/`
- Internet connection (FastF1 downloads from F1 servers)

## Steps

### 1. Install dependencies
```bash
cd f1_strategy
pip install -r requirements.txt
```

### 2. Run data extraction
```bash
# Full extraction (2019-2024, takes 30-60 min first time)
make fastf1-fetch

# Or run directly with custom years:
PYTHONPATH=. python -m f1pit.data.fetch_fastf1 --years 2019 2020 2021 2022 2023 2024
```

### 3. Verify output files
After extraction, `data/processed/` should contain:
| File | Description | Key Columns |
|------|-------------|-------------|
| `DryQuickLaps.csv` | Competitive dry-weather laps (107% rule) | Driver, Team, LapTime, Compound, TyreLife, LapTimePerKM |
| `Stints.csv` | Stint-level summaries | Driver, Stint, Compound, StintLength |
| `Strategyfull.csv` | Full strategy per driver per race | Driver, GP, Compounds used |
| `Inlaps.csv` | Last laps before pit stops | LapTime, LapTimePerKM, TyreLife |
| `Outlaps.csv` | First laps after pit stops | LapTime, LapTimePerKM |
| `PitstopsWithTeams.csv` | Pit stop durations | PitstopT, GP, Team |
| `SafetyCars.csv` | Track status per lap | LapNumber, TrackStatus, Label |
| `NLaps.csv` | Total laps per race | GP, Year, Laps |

### 4. Caching
FastF1 caches raw API responses in `data/raw/fastf1_cache/` by default. If extraction is interrupted, re-running will resume from cache.

## Troubleshooting

- **Rate limiting**: FastF1 may throttle requests. Wait 5 minutes and retry.
- **Missing races**: Some sprint races or cancelled sessions may be skipped automatically.
- **No weather data**: The script filters for dry races. Wet races are excluded.
- **Missing circuit info**: Ensure `data/CircuitInfo.csv` exists with circuit characteristics (Length, Abrasion, etc.)

## Data Quality Checks
After extraction, verify:
```python
import pandas as pd
df = pd.read_csv("../data/processed/DryQuickLaps.csv")
print(f"Rows: {len(df)}, Years: {df['Year'].unique()}, GPs: {df['GP'].nunique()}")
assert len(df) > 10000, "Too few rows – check extraction"
assert "LapTimePerKM" in df.columns, "Missing computed column"
```
