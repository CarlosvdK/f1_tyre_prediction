import { useEffect, useMemo, useRef, useState } from 'react';
import CarViewer from './components/CarViewer';
import TrackMap3D from './components/TrackMap3D';
import {
  getPredictions,
  listDrivers,
  listLaps,
  listTracks,
  type Compound,
  type FeatureKey,
  type Prediction,
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
  /* ── State ──────────────────────────────────────────────────── */
  const [tracks, setTracks] = useState<Track[]>([]);
  const [drivers, setDrivers] = useState<string[]>([]);
  const [laps, setLaps] = useState<number[]>([]);
  const [track, setTrack] = useState('');
  const [driver, setDriver] = useState('');
  const [lap, setLap] = useState(1);
  const [compound, setCompound] = useState<Compound>('medium');
  const [conditions, setConditions] = useState<TrackCondition>('dry');
  const [feature, setFeature] = useState<FeatureKey>('degradation_intensity_proxy');
  const [isPlaying, setIsPlaying] = useState(false);

  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedTrack = useMemo(
    () => tracks.find((t) => t.id === track) ?? tracks[0] ?? null,
    [tracks, track],
  );

  /* ── Animated metric values ─────────────────────────────────── */
  const animPace = useAnimatedValue(prediction?.sec_per_lap_increase ?? 0);
  const animLife = useAnimatedValue(prediction?.tyre_life_pct ?? 0);

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
        setDrivers(items);
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
    getPredictions(track, driver, lap, compound, conditions)
      .then((pred) => {
        if (!alive) return;
        setPrediction(pred);
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load data'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [track, driver, lap, compound, conditions]);

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

  /* ── Derived ────────────────────────────────────────────────── */
  const pitWindowText = prediction
    ? `L${prediction.pit_window_start}–L${prediction.pit_window_end}`
    : '—';
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
          <span className="nav-badge">Driver <strong>{driver || '—'}</strong></span>
          <div className="nav-sep" />
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
          compound={compound}
          wear={{
            wear_FL: prediction?.wear_FL,
            wear_FR: prediction?.wear_FR,
            wear_RL: prediction?.wear_RL,
            wear_RR: prediction?.wear_RR,
          }}
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
          <div className="ctrl-cell">
            <span className="ctrl-label">Driver</span>
            <select className="ctrl-select" value={driver} onChange={(e) => setDriver(e.target.value)}>
              {drivers.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="ctrl-cell">
            <span className="ctrl-label">Tyre</span>
            <select
              className={`ctrl-select compound-${compound}`}
              value={compound}
              onChange={(e) => setCompound(e.target.value as Compound)}
            >
              {(['soft', 'medium', 'hard', 'inter', 'wet'] as Compound[]).map((c) => (
                <option key={c} value={c}>{c.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div className="ctrl-cell">
            <span className="ctrl-label">Conditions</span>
            <select className="ctrl-select" value={conditions} onChange={(e) => setConditions(e.target.value as TrackCondition)}>
              {(['dry', 'hot', 'cool', 'damp', 'wet'] as TrackCondition[]).map((c) => (
                <option key={c} value={c}>{c.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div className="ctrl-cell">
            <span className="ctrl-label">Heatmap</span>
            <select className="ctrl-select" value={feature} onChange={(e) => setFeature(e.target.value as FeatureKey)}>
              <option value="degradation_intensity_proxy">Degradation</option>
              <option value="braking_earlier_delta">Braking Earlier</option>
              <option value="lower_corner_speed_delta">Corner Speed Δ</option>
              <option value="throttle_delay_delta">Throttle Delay</option>
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
          <div className="telem-label">Pit Window</div>
          <div className={`telem-value${!prediction ? ' loading' : ''}`}>
            {pitWindowText}
          </div>
        </div>

        <div className="telem-item">
          <div className="telem-label">Tyre Life</div>
          <div className={`telem-value${!prediction ? ' loading' : ''}`}>
            {prediction ? animLife.toFixed(1) : '—'}
            <span className="telem-unit">%</span>
          </div>
        </div>

        <div className="telem-item">
          <div className="telem-label">Compound</div>
          <div className={`telem-value v-${compound}`}>{compound.toUpperCase()}</div>
        </div>

        <div className="telem-item">
          <div className="telem-label">Conditions</div>
          <div className="telem-value">{conditions.toUpperCase()}</div>
        </div>

        <div className="telem-item">
          <div className="telem-label">Circuit</div>
          <div className="telem-value" style={{ fontSize: 'clamp(0.88rem, 1.4vw, 1.2rem)' }}>
            {selectedTrack?.name ?? '—'}
          </div>
        </div>
      </div>

      {/* ── Circuit telemetry map ─────────────────────────────── */}
      <section className="track-section">
        <div className="track-section-head">
          <div>
            <div className="track-section-title">Circuit Telemetry Map</div>
            <div className="track-section-sub">
              {selectedTrack?.name ?? '—'} · {feature.replace(/_/g, ' ')} · Lap {lap}
            </div>
          </div>
          <div className="track-feature-legend">
            <div className="feature-legend-item">
              <span className="feature-legend-dot" style={{ background: '#1e56c8' }} />Low stress
            </div>
            <div className="feature-legend-item">
              <span className="feature-legend-dot" style={{ background: 'rgba(200,215,240,0.6)' }} />Neutral
            </div>
            <div className="feature-legend-item">
              <span className="feature-legend-dot" style={{ background: '#cf2020' }} />High stress
            </div>
            <div className="feature-legend-item">
              <span className="feature-legend-dot" style={{ background: 'rgba(255,100,80,0.9)' }} />Braking zone
            </div>
          </div>
        </div>
        <div className="track-map-wrap">
          <TrackMap3D trackId={track} />
        </div>
      </section>

      {(loading || error) && (
        <div className="status-strip">
          {loading && <span>Loading telemetry…</span>}
          {error && <span className="error">{error}</span>}
        </div>
      )}
    </div>
  );
}
