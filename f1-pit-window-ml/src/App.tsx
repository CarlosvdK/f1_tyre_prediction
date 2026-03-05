import { useEffect, useMemo, useState } from 'react';
import CarViewer from './components/CarViewer';
import ControlsBar from './components/ControlsBar';
import DebugPanel from './components/DebugPanel';
import KpiPanel from './components/KpiPanel';
import TrackMap from './components/TrackMap';
import {
  getPredictions,
  getTelemetry,
  listDrivers,
  listLaps,
  listTracks,
  type Compound,
  type FeatureKey,
  type Prediction,
  type TelemetryPoint,
  type ThemeMode,
  type Track,
  type TrackCondition,
} from './data/api';

const THEME_STORAGE_KEY = 'f1_dashboard_theme';

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  });

  const [tracks, setTracks] = useState<Track[]>([]);
  const [drivers, setDrivers] = useState<string[]>([]);
  const [laps, setLaps] = useState<number[]>([]);

  const [track, setTrack] = useState<string>('');
  const [driver, setDriver] = useState<string>('');
  const [lap, setLap] = useState<number>(1);

  const [compound, setCompound] = useState<Compound>('medium');
  const [conditions, setConditions] = useState<TrackCondition>('dry');
  const [feature, setFeature] = useState<FeatureKey>('degradation_intensity_proxy');

  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const [baselineTelemetry, setBaselineTelemetry] = useState<TelemetryPoint[]>([]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const [modelMeta, setModelMeta] = useState<{
    modelPath?: string;
    modelType?: string;
    tireCount: number;
    error?: string;
  }>({ tireCount: 0 });

  const selectedTrack = useMemo(
    () => tracks.find((item) => item.id === track) ?? tracks[0] ?? null,
    [tracks, track],
  );

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    let alive = true;

    async function loadInitial() {
      try {
        const items = await listTracks();
        if (!alive) {
          return;
        }
        setTracks(items);
        if (items.length > 0) {
          setTrack((current) => current || items[0].id);
        }
      } catch (loadError) {
        if (alive) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load tracks');
        }
      }
    }

    void loadInitial();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!track) {
      return;
    }

    let alive = true;

    async function loadDrivers() {
      try {
        const items = await listDrivers(track);
        if (!alive) {
          return;
        }

        setDrivers(items);
        setDriver((current) => (items.includes(current) ? current : (items[0] ?? '')));
      } catch (loadError) {
        if (alive) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load drivers');
        }
      }
    }

    void loadDrivers();

    return () => {
      alive = false;
    };
  }, [track]);

  useEffect(() => {
    if (!track || !driver) {
      return;
    }

    let alive = true;

    async function loadLaps() {
      try {
        const items = await listLaps(track, driver);
        if (!alive) {
          return;
        }

        setLaps(items);
        setLap((current) => {
          if (items.length === 0) {
            return 1;
          }
          return items.includes(current) ? current : items[0];
        });
      } catch (loadError) {
        if (alive) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load laps');
        }
      }
    }

    void loadLaps();

    return () => {
      alive = false;
    };
  }, [track, driver]);

  useEffect(() => {
    if (!track || !driver || !lap) {
      return;
    }

    let alive = true;

    async function loadTelemetryAndPredictions() {
      setLoading(true);
      setError('');

      try {
        const baseLap = laps[0] ?? lap;
        const [lapTelemetry, baseline, pred] = await Promise.all([
          getTelemetry(track, driver, lap),
          getTelemetry(track, driver, baseLap),
          getPredictions(track, driver, lap, compound, conditions),
        ]);

        if (!alive) {
          return;
        }

        setTelemetry(lapTelemetry);
        setBaselineTelemetry(baseline);
        setPrediction(pred);
      } catch (loadError) {
        if (alive) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load telemetry or predictions',
          );
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    void loadTelemetryAndPredictions();

    return () => {
      alive = false;
    };
  }, [track, driver, lap, compound, conditions, laps]);

  return (
    <main className={`app-root theme-${theme}`}>
      <header className="app-header">
        <div>
          <p className="eyebrow">Interactive Demo</p>
          <h1>F1 Tyre Degradation Prediction Dashboard</h1>
        </div>
        <p className="subtitle">
          Mock telemetry + prediction stack with model-ready API adapters for real OpenF1/FastF1 data.
        </p>
      </header>

      <ControlsBar
        tracks={tracks}
        drivers={drivers}
        laps={laps}
        track={track}
        driver={driver}
        compound={compound}
        conditions={conditions}
        feature={feature}
        lap={lap}
        theme={theme}
        onTrackChange={setTrack}
        onDriverChange={setDriver}
        onCompoundChange={setCompound}
        onConditionsChange={setConditions}
        onFeatureChange={setFeature}
        onLapChange={setLap}
        onThemeToggle={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
      />

      <KpiPanel prediction={prediction} />

      <CarViewer
        compound={compound}
        wear={{
          wear_FL: prediction?.wear_FL,
          wear_FR: prediction?.wear_FR,
          wear_RL: prediction?.wear_RL,
          wear_RR: prediction?.wear_RR,
        }}
        theme={theme}
        onModelMetaChange={setModelMeta}
      />

      <TrackMap
        outline={selectedTrack?.outline ?? []}
        telemetry={telemetry}
        baselineTelemetry={baselineTelemetry}
        feature={feature}
        theme={theme}
      />

      <DebugPanel
        track={track}
        driver={driver}
        lap={lap}
        compound={compound}
        conditions={conditions}
        feature={feature}
        modelPath={modelMeta.modelPath}
        modelType={modelMeta.modelType}
        tireCount={modelMeta.tireCount}
        wear={{
          FL: prediction?.wear_FL ?? 0,
          FR: prediction?.wear_FR ?? 0,
          RL: prediction?.wear_RL ?? 0,
          RR: prediction?.wear_RR ?? 0,
        }}
      />

      {(loading || error || modelMeta.error) && (
        <aside className="status-strip">
          {loading && <span>Loading telemetry...</span>}
          {error && <span className="error">{error}</span>}
          {modelMeta.error && <span className="error">{modelMeta.error}</span>}
        </aside>
      )}
    </main>
  );
}
