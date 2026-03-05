import { useEffect, useMemo, useState } from 'react';
import CarViewer from './components/CarViewer';
import ControlsBar from './components/ControlsBar';
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
  type Track,
  type TrackCondition,
} from './data/api';

export default function App() {
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

  const selectedTrack = useMemo(
    () => tracks.find((item) => item.id === track) ?? tracks[0] ?? null,
    [tracks, track],
  );

  /* ── Load tracks ─────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    async function loadInitial() {
      try {
        const items = await listTracks();
        if (!alive) return;
        setTracks(items);
        if (items.length > 0) {
          setTrack((current) => current || items[0].id);
        }
      } catch (loadError) {
        if (alive) setError(loadError instanceof Error ? loadError.message : 'Failed to load tracks');
      }
    }
    void loadInitial();
    return () => { alive = false; };
  }, []);

  /* ── Load drivers ────────────────────────────────────────────── */
  useEffect(() => {
    if (!track) return;
    let alive = true;
    setIsPlaying(false);
    async function loadDrivers() {
      try {
        const items = await listDrivers(track);
        if (!alive) return;
        setDrivers(items);
        setDriver((current) => (items.includes(current) ? current : (items[0] ?? '')));
      } catch (loadError) {
        if (alive) setError(loadError instanceof Error ? loadError.message : 'Failed to load drivers');
      }
    }
    void loadDrivers();
    return () => { alive = false; };
  }, [track]);

  /* ── Load laps ───────────────────────────────────────────────── */
  useEffect(() => {
    if (!track || !driver) return;
    let alive = true;
    setIsPlaying(false);
    async function loadLaps() {
      try {
        const items = await listLaps(track, driver);
        if (!alive) return;
        setLaps(items);
        setLap((current) => {
          if (items.length === 0) return 1;
          return items.includes(current) ? current : items[0];
        });
      } catch (loadError) {
        if (alive) setError(loadError instanceof Error ? loadError.message : 'Failed to load laps');
      }
    }
    void loadLaps();
    return () => { alive = false; };
  }, [track, driver]);

  /* ── Load telemetry + predictions ───────────────────────────── */
  useEffect(() => {
    if (!track || !driver || !lap) return;
    let alive = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const baseLap = laps[0] ?? lap;
        const [lapTelemetry, baseline, pred] = await Promise.all([
          getTelemetry(track, driver, lap),
          getTelemetry(track, driver, baseLap),
          getPredictions(track, driver, lap, compound, conditions),
        ]);
        if (!alive) return;
        setTelemetry(lapTelemetry);
        setBaselineTelemetry(baseline);
        setPrediction(pred);
      } catch (loadError) {
        if (alive) setError(loadError instanceof Error ? loadError.message : 'Failed to load telemetry');
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => { alive = false; };
  }, [track, driver, lap, compound, conditions, laps]);

  /* ── Lap playback ────────────────────────────────────────────── */
  useEffect(() => {
    if (!isPlaying || laps.length < 2) return;
    const id = window.setInterval(() => {
      setLap((current) => {
        const idx = laps.indexOf(current);
        if (idx < 0) return laps[0];
        return laps[(idx + 1) % laps.length];
      });
    }, 900);
    return () => window.clearInterval(id);
  }, [isPlaying, laps]);

  return (
    <div className="f1-app">
      {/* ── Navigation ─────────────────────────────────────────── */}
      <nav className="f1-nav">
        <div className="nav-logo">
          <div className="nav-logo-mark">F1</div>
          <div className="nav-title">
            <span className="nav-title-main">Tyre Strategy</span>
            <span className="nav-title-sub">Prediction Dashboard</span>
          </div>
        </div>

        <div className="nav-divider" />

        <div className="nav-session">
          <span className="nav-session-dot" />
          <span className="nav-session-label">
            {selectedTrack?.name ?? 'Loading...'}
          </span>
        </div>

        <div className="nav-right">
          <span className="nav-badge">
            {driver || '—'}&nbsp;&nbsp;Lap {lap}
          </span>
        </div>
      </nav>

      {/* ── Controls Bar ─────────────────────────────────────────── */}
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
        onTrackChange={setTrack}
        onDriverChange={setDriver}
        onCompoundChange={setCompound}
        onConditionsChange={setConditions}
        onFeatureChange={setFeature}
        onLapChange={setLap}
        onPlayToggle={() => setIsPlaying((v) => !v)}
      />

      {/* ── Hero — 3D Car ─────────────────────────────────────────── */}
      <section className="hero-section">
        <div className="hero-label">
          <span className="hero-eyebrow">Live Model</span>
          <span className="hero-car-name">F1 Car</span>
          <span className="hero-car-sub">Tyre Wear Visualisation</span>
        </div>
        <CarViewer
          compound={compound}
          wear={{
            wear_FL: prediction?.wear_FL,
            wear_FR: prediction?.wear_FR,
            wear_RL: prediction?.wear_RL,
            wear_RR: prediction?.wear_RR,
          }}
        />
      </section>

      {/* ── Prediction Focus Bar ─────────────────────────────────── */}
      <div className="prediction-bar">
        <div className="pred-item">
          <div className="pred-item-label">Track</div>
          <div className="pred-item-value">{selectedTrack?.name ?? '—'}</div>
        </div>
        <div className="pred-item">
          <div className="pred-item-label">Driver</div>
          <div className="pred-item-value">{driver || '—'}</div>
        </div>
        <div className="pred-item">
          <div className="pred-item-label">Compound</div>
          <div className="pred-item-value">{compound.toUpperCase()}</div>
        </div>
        <div className="pred-item">
          <div className="pred-item-label">Conditions</div>
          <div className="pred-item-value">{conditions.toUpperCase()}</div>
        </div>
        <div className="pred-item">
          <div className="pred-item-label">Pit Window</div>
          <div className="pred-item-value">
            {prediction
              ? `L${prediction.pit_window_start}–L${prediction.pit_window_end}`
              : '—'}
          </div>
        </div>
      </div>

      {/* ── KPI Strip ────────────────────────────────────────────── */}
      <KpiPanel prediction={prediction} />

      {/* ── Track Map ────────────────────────────────────────────── */}
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
              <span className="feature-legend-dot" style={{ background: '#2b5ea6' }} />
              Low stress
            </div>
            <div className="feature-legend-item">
              <span className="feature-legend-dot" style={{ background: '#dee6f3' }} />
              Neutral
            </div>
            <div className="feature-legend-item">
              <span className="feature-legend-dot" style={{ background: '#cf4637' }} />
              High stress
            </div>
            <div className="feature-legend-item">
              <span className="feature-legend-dot" style={{ background: 'rgba(255,116,94,0.9)', border: '1px solid rgba(255,180,170,0.4)' }} />
              Braking zone
            </div>
          </div>
        </div>
        <div className="track-map-wrap">
          <TrackMap
            outline={selectedTrack?.outline ?? []}
            telemetry={telemetry}
            baselineTelemetry={baselineTelemetry}
            feature={feature}
          />
        </div>
      </section>

      {/* ── Status Strip ─────────────────────────────────────────── */}
      {(loading || error) && (
        <div className="status-strip">
          {loading && <span>Loading telemetry…</span>}
          {error && <span className="error">{error}</span>}
        </div>
      )}
    </div>
  );
}
