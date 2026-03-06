# Run Commands

All commands should be run from the **`f1_tyre_prediction/`** root directory.

## Terminal 1 — Backend API
```bash
cd f1_strategy && make serve
```

## Terminal 2 — Frontend UI
```bash
cd ui && npm install && npm run dev
```

Then open **http://localhost:5173**

## Other Useful Commands
```bash
# Extract data from FastF1 API
cd f1_strategy && make fastf1-fetch

# Train ML models
cd f1_strategy && make strategy-train

# Run tests
cd f1_strategy && make test
```
