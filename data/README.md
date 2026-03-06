# F1 Tyre Strategy – Data

Data extracted from the F1 API using the [FastF1](https://docs.fastf1.dev/) Python library.
Spans **2019–2024** (up to the Singapore GP). Training: 2019–2023, Testing: 2024.

## Files

| File | Description |
|------|-------------|
| `CircuitInfo.csv` | Track characteristics (Length, Abrasion, Traction, etc.) from Pirelli |
| `DryQuickLaps.csv` | Competitive dry laps filtered by the 107% rule (~64,500 records) |
| `Inlaps.csv` | Laps entering the pits (same structure as DryQuickLaps) |
| `Nlaps.csv` | Total race laps per circuit per year |
| `Outlaps.csv` | Laps exiting the pits (same structure as DryQuickLaps) |
| `Pitstops.csv` | Pit stop durations (without team info) |
| `PitstopsWithTeams.csv` | Pit stop durations including team |
| `SafetyCars.csv` | Track status per lap (SC, VSC, Yellow, AllClear) for all years |
| `SafetyCars2024.csv` | Track status for 2024 only (test set) |
| `Stints.csv` | Stint-level data (driver, compound, stint length) |
| `Strategyfull.csv` | Full tyre strategy per driver per race |

## DryQuickLaps Columns

| Column | Description |
|--------|-------------|
| Driver | Driver abbreviation (e.g. "VER", "HAM") |
| Team | Team name |
| LapNumber | Lap number |
| LapTime | Lap time in seconds |
| Stint | Stint number |
| Compound | Tyre compound (SOFT, MEDIUM, HARD) |
| TyreLife | Laps on current tyres |
| Position | Track position |
| Year | Season year |
| GP | Grand Prix name |
| Length | Circuit length (km) |
| Abrasion–TyreStress | Circuit characteristics from Pirelli |
| LapTimePerKM | Standardized lap time (LapTime / Length) |
| Laps | Total race laps |
| RacePercentage | Race completion % (LapNumber / Laps) |
