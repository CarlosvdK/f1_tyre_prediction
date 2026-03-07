import pandas as pd
import glob
import os

pd.set_option("display.width", None)
pd.set_option("display.max_columns", None)

BASE = os.path.dirname(os.path.abspath(__file__))

for f in sorted(glob.glob(os.path.join(BASE, "**/*.csv"), recursive=True)):
    name = os.path.relpath(f, BASE)
    df = pd.read_csv(f)
    print(f"\n{'='*80}")
    print(f"{name}  —  {df.shape[0]} rows x {df.shape[1]} cols")
    print(f"Columns: {list(df.columns)}")
    print(f"{'='*80}")
    print(df.head().to_string())
    print()

for f in sorted(glob.glob(os.path.join(BASE, "**/*.parquet"), recursive=True)):
    name = os.path.relpath(f, BASE)
    df = pd.read_parquet(f)
    print(f"\n{'='*80}")
    print(f"{name}  —  {df.shape[0]} rows x {df.shape[1]} cols")
    print(f"Columns: {list(df.columns)}")
    print(f"{'='*80}")
    print(df.head().to_string())
    print()
