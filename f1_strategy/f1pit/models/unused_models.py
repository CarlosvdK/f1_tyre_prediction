"""
Unused models: trained but not used in the final strategy optimizer.

These models were originally built as part of a more granular pit stop and
race simulation approach. During development we found that simpler methods
either already capture the same information or that the prediction target
is fundamentally unpredictable. They remain here for reference.

-----------------------------------------------------------------------
1. Inlap Model (GradientBoosting regression, R²=0.51, MAE=1.48s)
-----------------------------------------------------------------------
   Predicts the lap time of the "in-lap" — the lap where a driver dives
   into the pit lane. In-laps are typically 2-3s slower than normal laps
   because the driver brakes early and enters the pit lane speed limit zone.

   Features: GP, Compound, TyreLife, Stint, Position, RacePercentage

   WHY WE BUILT IT:
   The original plan was to model each component of a pit stop separately:
   in-lap slowdown + stationary time + out-lap slowdown. This would let us
   capture how position, tyre wear, and track layout each affect different
   phases of the pit stop independently.

   WHY WE DON'T USE IT:
   The per-circuit median pit cost (from Pitstops.csv) already captures the
   aggregate effect of slow in-laps and out-laps. Using inlap/outlap
   predictions on top of that would double-count the time penalty. The
   per-circuit average turned out to be accurate enough for strategy
   selection — the difference between a granular and aggregate approach is
   ~0.2-0.5s per stop, which rarely changes which strategy is optimal.

-----------------------------------------------------------------------
2. Outlap Model (GradientBoosting regression, R²=0.15, MAE=1.44s)
-----------------------------------------------------------------------
   Predicts the lap time of the "out-lap" — the first lap after leaving
   the pits. Out-laps are slow because tyres are cold (no grip) and the
   driver has to navigate through the pit exit.

   Features: GP, Compound, Stint, Position, RacePercentage

   WHY WE BUILT IT:
   Same reasoning as the inlap model — granular pit stop modelling.

   WHY WE DON'T USE IT:
   Same reason as above (double-counting with the pit cost average), plus the model
   itself is weak (R²=0.15 means it only explains 15% of out-lap time
   variance). Out-lap times are highly variable depending on traffic,
   tyre warming strategy, and whether the driver is pushing or managing,
   making them hard to predict reliably.

-----------------------------------------------------------------------
3. Safety Car Model (GradientBoosting classification, ROC-AUC=0.50)
-----------------------------------------------------------------------
   Predicts whether a Safety Car or Virtual Safety Car will be deployed
   on a given lap.

   Features: GP, LapNumber

   WHY WE BUILT IT:
   Safety cars massively affect optimal strategy — pitting under a safety
   car is essentially a "free" pit stop (the field bunches up, so you lose
   far less time). The idea was to estimate the probability of a safety car
   at each lap, then factor that into expected strategy value:
   "if there's a 20% chance of SC on lap 30, a strategy that pits on lap 30
   has a 20% chance of saving ~12s."

   WHY WE DON'T USE IT:
   Safety cars are caused by crashes and mechanical failures, which are
   fundamentally random events. The model achieved a ROC-AUC of 0.50,
   which is equivalent to a coin flip — it learned nothing. No combination
   of features (circuit, lap number, weather, historical rates) produced a
   model that could predict safety cars better than random chance. This
   makes sense: you can't predict when a driver will crash.

   The safety car model IS still used in one place: the reoptimize_mid_race
   endpoint, where it's not predicting IF a safety car will happen but
   adjusting strategy AFTER one has already happened (the `safety_car=True`
   flag applies a 12s pit cost discount to reflect the reduced time loss
   of pitting under caution).

-----------------------------------------------------------------------
4. PitstopT Model (RandomForest regression, R²=0.37, MAE=2.08s)
-----------------------------------------------------------------------
   Predicts the net time lost during a pit stop (stationary time + pit
   lane transit) at each circuit.

   Features: GP (just one feature — circuit name)

   WHY WE BUILT IT:
   It was trained alongside the other strategy models as part of a batch
   pipeline. The idea was to have an ML model predict pit cost so it could
   generalise to new circuits or capture trends over time.

   WHY WE DON'T USE IT:
   With only one feature (GP), the model is effectively just a per-circuit
   average — a lookup table with extra overhead. We replaced it with a
   direct per-circuit median computed from Pitstops.csv (~4000 real pit
   stops, 2019-2024, filtered to <60s to exclude red flags). This gives
   the same accuracy, is simpler to understand, and doesn't require
   loading a .joblib file. For circuits not in the data, we fall back to
   the overall median of 23.5s.
"""
