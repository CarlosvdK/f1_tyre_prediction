"""Quick overview of all processed CSV files."""

import pandas as pd
from pathlib import Path

DATA_DIR = Path(__file__).parent

csv_files = sorted(DATA_DIR.glob("*.csv"))

for csv_path in csv_files:
    df = pd.read_csv(csv_path)
    print(f"\n{'='*60}")
    print(f"{csv_path.name}  —  {len(df)} rows × {len(df.columns)} cols")
    print('='*60)
    print(df.head())
