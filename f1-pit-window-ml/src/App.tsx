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
const SETTINGS_STORAGE_KEY = 'f1_dashboard_settings_open';
const DEBUG_STORAGE_KEY = 'f1_dashboard_debug_open';

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
  const [isPlaying, setIsPlaying] = useState(false);

  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const [baselineTelemetry, setBaselineTelemetry] = useState<TelemetryPoint[]>([]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [settingsOpen, setSettingsOpen] = useState<boolean>(() => localStorage.getItem(SETTINGS_STORAGE_KEY) === '1');
  const [debugOpen, setDebugOpen] = useState<boolean>(() => localStorage.getItem(DEBUG_STORAGE_KEY) === '1');

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
    localStorage.setItem(SETTINGS_STORAGE_KEY, settingsOpen ? '1' : '0');
  }, [settingsOpen]);

  useEffect(() => {
    localStorage.setItem(DEBUG_STORAGE_KEY, debugOpen ? '1' : '0');
  }, [debugOpen]);

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
    setIsPlaying(false);

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
    setIsPlaying(false);

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

  useEffect(() => {
    if (!isPlaying || laps.length < 2) {
      return;
    }
    const id = window.setInterval(() => {
      setLap((current) => {
        const idx = laps.indexOf(current);
        if (idx < 0) {
          return laps[0];
        }
        return laps[(idx + 1) % laps.length];
      });
    }, 900);
    return () => window.clearInterval(id);
  }, [isPlaying, laps]);

  return (
    <main className={`app-root theme-${theme}`}>
      <div className="broadcast-frame">
        <header className="f1-topbar">
          <div className="f1-logo-wrap">
            <span className="f1-logo">F1</span>
            <span className="f1-series">Race Series</span>
          </div>
          <div className="f1-top-links">
            <span>AUTHENTICS</span>
            <span>STORE</span>
            <span>TICKETS</span>
            <span>HOSPITALITY</span>
            <button type="button" className="tiny-btn">Sign In</button>
            <button type="button" className="tiny-btn accent">Subscribe</button>
          </div>
        </header>

        <nav className="f1-main-nav">
          {['Schedule', 'Results', 'News', 'Drivers', 'Teams', 'Fantasy & Gaming', "Members' Area"].map((item) => (
            <span key={item}>{item}</span>
          ))}
        </nav>

        <section className="f1-race-ribbon">
          <div>
            <p>{selectedTrack?.name ?? 'Circuit'}</p>
            <strong>FP1 Session • Tyre Intel Feed</strong>
          </div>
          <div className="ribbon-right">
            <span>MY TIME 19:40</span>
            <span>TRACK TIME 05:40</span>
          </div>
        </section>

        <header className="app-header">
          <div>
            <p className="eyebrow">Race Engineering Dashboard</p>
            <h1>Tyre Degradation Intelligence</h1>
            <p className="subtitle">
              Studio-grade car rendering, race telemetry overlays, and model-driven pit-window strategy signals.
            </p>
          </div>
        </header>

        <div className="dashboard-grid">
          <section className="main-column">
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
              isPlaying={isPlaying}
              theme={theme}
              onTrackChange={setTrack}
              onDriverChange={setDriver}
              onCompoundChange={setCompound}
              onConditionsChange={setConditions}
              onFeatureChange={setFeature}
              onLapChange={setLap}
              onPlayToggle={() => setIsPlaying((value) => !value)}
              onThemeToggle={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
              onSettingsToggle={() => setSettingsOpen((value) => !value)}
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
          </section>

          <aside className="panel side-column">
            <h3>Strategy Feed</h3>
            <article className="news-card">
              <p className="news-tag">LIVE</p>
              <p>Front-left wear trending above baseline in sectors 2 and 3.</p>
            </article>
            <article className="news-card">
              <p className="news-tag">PACE</p>
              <p>Predicted pace drop crosses threshold near lap {prediction?.pit_window_start ?? lap + 3}.</p>
            </article>
            <article className="news-card">
              <p className="news-tag">RISK</p>
              <p>Brake thermal stress rises in high-load corners under hot-track conditions.</p>
            </article>
            <article className="news-card">
              <p className="news-tag">CALL</p>
              <p>Recommended undercut window: laps {prediction?.pit_window_start ?? 0}-{prediction?.pit_window_end ?? 0}.</p>
            </article>
          </aside>
        </div>
      </div>

      <aside className={`settings-drawer ${settingsOpen ? 'open' : ''}`}>
        <div className="drawer-head">
          <h3>Advanced Settings</h3>
          <button type="button" onClick={() => setSettingsOpen(false)}>
            Close
          </button>
        </div>

        <div className="drawer-section">
          <p className="drawer-label">Model source</p>
          <p className="drawer-value">{modelMeta.modelType ?? '-'}</p>
          <p className="drawer-path">{modelMeta.modelPath ?? '-'}</p>
        </div>

        <div className="drawer-section">
          <p className="drawer-label">Tyre material mapping</p>
          <p className="drawer-value">Detected tyre meshes: {modelMeta.tireCount}</p>
          <p className="drawer-note">
            Advanced raw material list can be extended from CarViewer traversal for per-material tuning.
          </p>
        </div>

        <details open={debugOpen} onToggle={(event) => setDebugOpen((event.target as HTMLDetailsElement).open)}>
          <summary>Debug panel</summary>
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
        </details>
      </aside>

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
