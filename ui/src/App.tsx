import { useEffect, useMemo, useRef, useState } from 'react';
import CarViewer from './components/CarViewer';
import DegradationChart from './components/DegradationChart';
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
  type Track,
  type TrackCondition,
} from './data/api';

/* ── Animated number hook ─────────────────────────────────────── */
function useAnimatedValue(target: number, duration = 500): number {
  const [current, setCurrent] = useState(target);
  const prevTarget = useRef(target);

  useEffect(() => {
    if (Math.abs(prevTarget.current - target) < 0.001) return;
    prevTarget.current = target;
    const from = current;
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      setCurrent(from + (target - from) * ease);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  return current;
}

export default function App() {
  const MODEL_COMPOUND: Compound = 'medium';
  const MODEL_CONDITION: TrackCondition = 'dry';
  const MAP_FEATURE: FeatureKey = 'degradation_intensity_proxy';

  /* ── State ──────────────────────────────────────────────────── */
  const [tracks, setTracks] = useState<Track[]>([]);
  const [laps, setLaps] = useState<number[]>([]);
  const [track, setTrack] = useState('');
  const [driver, setDriver] = useState('');
  const [lap, setLap] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);

  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const [baselineTelemetry, setBaselineTelemetry] = useState<TelemetryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedTrack = useMemo(
    () => tracks.find((t) => t.id === track) ?? tracks[0] ?? null,
    [tracks, track],
  );

  /* ── Animated metric values ───────────────────────── */
  const animPace = useAnimatedValue(prediction?.sec_per_lap_increase ?? 0);

  /* ── Data loading ──────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    listTracks()
      .then((items) => {
        if (!alive) return;
        setTracks(items);
        if (items.length) setTrack((c) => c || items[0].id);
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load tracks'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!track) return;
    let alive = true;
    setIsPlaying(false);
    listDrivers(track)
      .then((items) => {
        if (!alive) return;
        setDriver((c) => (items.includes(c) ? c : items[0] ?? ''));
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load drivers'); });
    return () => { alive = false; };
  }, [track]);

  useEffect(() => {
    if (!track || !driver) return;
    let alive = true;
    setIsPlaying(false);
    listLaps(track, driver)
      .then((items) => {
        if (!alive) return;
        setLaps(items);
        setLap((c) => (items.length === 0 ? 1 : items.includes(c) ? c : items[0]));
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load laps'); });
    return () => { alive = false; };
  }, [track, driver]);

  useEffect(() => {
    if (!track || !driver || !lap) return;
    let alive = true;
    setLoading(true);
    setError('');
    getPredictions(track, driver, lap, MODEL_COMPOUND, MODEL_CONDITION)
      .then((pred) => {
        if (!alive) return;
        setPrediction(pred);
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load data'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [track, driver, lap]);

  useEffect(() => {
    if (!track || !driver || !lap) return;
    let alive = true;
    const baselineLap = Math.max(1, lap - 5);
    setMapLoading(true);
    Promise.all([
      getTelemetry(track, driver, lap),
      getTelemetry(track, driver, baselineLap),
    ])
      .then(([current, baseline]) => {
        if (!alive) return;
        setTelemetry(current);
        setBaselineTelemetry(baseline);
      })
      .catch((e) => {
        if (!alive) return;
        setTelemetry([]);
        setBaselineTelemetry([]);
        setError(e instanceof Error ? e.message : 'Failed to load telemetry map');
      })
      .finally(() => {
        if (alive) setMapLoading(false);
      });
    return () => { alive = false; };
  }, [track, driver, lap]);

  useEffect(() => {
    if (!isPlaying || laps.length < 2) return;
    const id = window.setInterval(() => {
      setLap((c) => {
        const idx = laps.indexOf(c);
        return laps[(idx < 0 ? 0 : idx + 1) % laps.length];
      });
    }, 900);
    return () => window.clearInterval(id);
  }, [isPlaying, laps]);


  const maxLap = laps[laps.length - 1] ?? 1;
  const minLap = laps[0] ?? 1;

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div className="f1-app">

      {/* ── Transparent nav — sits visually over the 3D scene via sticky/z-index ── */}
      <nav className="f1-nav">
        <div className="nav-logo">
          <span className="nav-logo-f1">F1</span>
          <div>
            <span className="nav-title-main">Tyre Strategy</span>
            <span className="nav-title-sub">Prediction Dashboard</span>
          </div>
        </div>
        <div className="nav-sep" />
        <div className="nav-live">
          <span className="nav-live-dot" />
          {selectedTrack?.name ?? 'Loading…'}
        </div>
        <div className="nav-right">
          <span className="nav-badge">Lap <strong>{lap} / {maxLap}</strong></span>
        </div>
      </nav>

      {/* ═══════════════════════════════════════════════════════════
          FULL-BLEED SCENE SHELL
          3D canvas + gradient scrims + overlay controls
          ═══════════════════════════════════════════════════════════ */}
      <div className="scene-shell">

        {/* Full-bleed 3D */}
        <CarViewer
          compound={MODEL_COMPOUND}
          wear={{
            wear_FL: prediction?.wear_FL,
            wear_FR: prediction?.wear_FR,
            wear_RL: prediction?.wear_RL,
            wear_RR: prediction?.wear_RR,
          }}
          prediction={prediction}
          currentLap={lap}
        />

        {/* Gradient scrims */}
        <div className="scene-top-scrim" />
        <div className="scene-bottom-scrim" />

        {/* Controls overlay */}
        <div className="controls-overlay">
          <div className="ctrl-cell">
            <span className="ctrl-label">Circuit</span>
            <select className="ctrl-select" value={track} onChange={(e) => setTrack(e.target.value)}>
              {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="ctrl-lap">
            <span className="ctrl-lap-value">Lap {lap}</span>
            <button
              type="button"
              className="play-btn"
              onClick={() => setIsPlaying((v) => !v)}
              disabled={laps.length < 2}
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
            <input
              type="range"
              min={minLap}
              max={maxLap}
              step={1}
              value={lap}
              onChange={(e) => setLap(Number(e.target.value))}
              disabled={laps.length === 0}
            />
          </div>
        </div>

        <div className="scene-data-overlays">
          <section className="scene-glass-card scene-chart-card">
            <div className="scene-card-body">
              <DegradationChart
                currentLap={lap}
                totalLaps={maxLap}
                prediction={prediction}
                compound={prediction?.strategy_stint1_compound ?? MODEL_COMPOUND}
              />
            </div>
          </section>

          <section className="scene-glass-card scene-map-card">
            <header className="scene-card-head">
              <div>
                <h2 className="scene-card-title">Telemetry Feature Map</h2>
                <p className="scene-card-sub">Lap {lap} vs baseline lap {Math.max(1, lap - 5)}</p>
              </div>
              <div className="track-feature-legend">
                <span className="feature-legend-item">
                  <span className="feature-legend-dot" style={{ background: '#1e56c8' }} />
                  Lower
                </span>
                <span className="feature-legend-item">
                  <span className="feature-legend-dot" style={{ background: '#dee6f3' }} />
                  Neutral
                </span>
                <span className="feature-legend-item">
                  <span className="feature-legend-dot" style={{ background: '#cf2020' }} />
                  Higher
                </span>
              </div>
            </header>
            <div className="scene-card-body">
              <TrackMap
                outline={selectedTrack?.outline ?? []}
                telemetry={telemetry}
                baselineTelemetry={baselineTelemetry}
                feature={MAP_FEATURE}
                lap={lap}
              />
            </div>
          </section>
        </div>

        {/* Floating corner meta */}
        <div className="scene-label">
          <span className="scene-eyebrow">Drag to rotate · Full 360°</span>
          <span className="scene-car-name">F1 Car</span>
          <span className="scene-car-sub">Tyre Wear Live Model</span>
        </div>
        <span className="orbit-hint">← Drag to rotate →</span>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          BOTTOM TELEMETRY STRIP — one row, all metrics, no cards
          ═══════════════════════════════════════════════════════════ */}
      <div className="telem-strip">
        <div className="telem-item">
          <div className="telem-label">Pace Loss / Lap</div>
          <div className={`telem-value${!prediction ? ' loading' : ''}`}>
            {prediction ? animPace.toFixed(3) : '—'}
            <span className="telem-unit">s/lap</span>
          </div>
        </div>

        <div className="telem-item highlight">
          <div className="telem-label">Optimal Pit</div>
          <div className={`telem-value${!prediction ? ' loading' : ''}`}>
            {prediction ? `Lap ${prediction.strategy_optimal_pit_lap}` : '—'}
            {prediction && <span className="telem-unit">({prediction.strategy_stint1_laps}+{prediction.strategy_stint2_laps})</span>}
          </div>
        </div>

        <div className="telem-item">
          <div className="telem-label">Time Saved</div>
          <div className={`telem-value${!prediction ? ' loading' : ''}`}>
            {prediction ? prediction.strategy_time_saved_fmt : '—'}
          </div>
        </div>

        <div className="telem-item strategy-visual">
          <div className="telem-label">Race Strategy</div>
          <div className={`strategy-bar${!prediction ? ' loading' : ''}`}>
            {prediction ? (
              <>
                <div
                  className={`strat-stint bg-${prediction.strategy_stint1_compound}`}
                  style={{ flex: prediction.strategy_stint1_laps }}
                  title={`${prediction.strategy_stint1_compound} (${prediction.strategy_stint1_laps} Laps)`}
                ></div>
                <div
                  className={`strat-stint bg-${prediction.strategy_stint2_compound}`}
                  style={{ flex: prediction.strategy_stint2_laps }}
                  title={`${prediction.strategy_stint2_compound} (${prediction.strategy_stint2_laps} Laps)`}
                ></div>
              </>
            ) : <div className="strat-stint empty"></div>}
          </div>
          <div className="strategy-labels">
            {prediction ? (
              <>
                <span>{prediction.strategy_stint1_compound?.toUpperCase()}</span>
                <span>→</span>
                <span>{prediction.strategy_stint2_compound?.toUpperCase()}</span>
              </>
            ) : (
              <span>—</span>
            )}
          </div>
        </div>

        <div className="telem-item">
          <div className="telem-label">Circuit</div>
          <div className="telem-value" style={{ fontSize: 'clamp(0.88rem, 1.4vw, 1.2rem)' }}>
            {selectedTrack?.name ?? '—'}
          </div>
        </div>
      </div>

      {(loading || mapLoading || error) && (
        <div className="status-strip">
          {loading && <span>Loading telemetry…</span>}
          {mapLoading && <span>Refreshing map…</span>}
          {error && <span className="error">{error}</span>}
        </div>
      )}
    </div>
  );
}
