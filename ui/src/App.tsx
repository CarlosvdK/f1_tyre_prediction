import { useEffect, useMemo, useRef, useState } from 'react';
import CarViewer from './components/CarViewer';
import DegradationChart from './components/DegradationChart';
import InfoTip from './components/InfoTip';
import TrackMap from './components/TrackMap';
import {
  getPredictions,
  getTelemetry,
  listDrivers,
  listLaps,
  listTracks,
  type Compound,
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

        {/* Lap controls — center bottom */}
        <div className="controls-center">
          <span className="ctrl-lap-value">Lap {lap} / {maxLap}</span>
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
                <InfoTip text="Shows predicted braking and acceleration zones around the circuit for the current lap. As tyres degrade, braking zones grow longer (thicker red lines) because the driver must brake earlier with less grip. Acceleration zones shrink (thinner green lines) as traction reduces. Compare against the faint fresh-tyre braking outline to see the degradation effect. Hover over any zone for details.">
                  <h2 className="scene-card-title">Braking &amp; Acceleration Map</h2>
                </InfoTip>
                <p className="scene-card-sub">Lap {lap} · Stint {lap > (prediction?.strategy_optimal_pit_lap ?? Math.floor(maxLap / 2)) ? 2 : 1} · Stint lap {lap > (prediction?.strategy_optimal_pit_lap ?? Math.floor(maxLap / 2)) ? lap - (prediction?.strategy_optimal_pit_lap ?? Math.floor(maxLap / 2)) : lap}</p>
              </div>
              <div className="track-feature-legend">
                <span className="feature-legend-item">
                  <span className="feature-legend-dot" style={{ background: '#ff6450' }} />
                  Braking
                </span>
                <span className="feature-legend-item">
                  <span className="feature-legend-dot" style={{ background: '#36e888' }} />
                  Throttle
                </span>
                <span className="feature-legend-item">
                  <span className="feature-legend-dot" style={{ background: 'rgba(255,255,255,0.2)' }} />
                  Fresh ref
                </span>
              </div>
            </header>
            <div className="scene-card-body">
              <TrackMap
                outline={selectedTrack?.outline ?? []}
                telemetry={telemetry}
                baselineTelemetry={baselineTelemetry}
                lap={lap}
                totalLaps={maxLap}
                prediction={prediction}
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
          <InfoTip text="Average seconds lost per lap due to tyre degradation. Derived from the ML model's predicted lap time delta and rolling pace slope — higher values mean tyres are wearing faster.">
            <div className="telem-label">Pace Loss / Lap</div>
          </InfoTip>
          <div className={`telem-value${!prediction ? ' loading' : ''}`}>
            {prediction ? animPace.toFixed(3) : '—'}
            <span className="telem-unit">s/lap</span>
          </div>
        </div>

        <div className="telem-item highlight">
          <InfoTip text="The model-recommended lap to pit. Computed by evaluating every possible pit lap across all legal 2-compound combinations and selecting the one that minimises total race time (stint pace + degradation + 24.5s pit penalty).">
            <div className="telem-label">Optimal Pit</div>
          </InfoTip>
          <div className={`telem-value${!prediction ? ' loading' : ''}`}>
            {prediction ? `Lap ${prediction.strategy_optimal_pit_lap}` : '—'}
            {prediction && <span className="telem-unit">({prediction.strategy_stint1_laps}+{prediction.strategy_stint2_laps})</span>}
          </div>
        </div>

        <div className="telem-item">
          <InfoTip text="Total race time saved by pitting optimally vs. running a no-stop strategy on the same compound. Accounts for cumulative degradation over the full race distance minus the pit stop time cost.">
            <div className="telem-label">Time Saved</div>
          </InfoTip>
          <div className={`telem-value${!prediction ? ' loading' : ''}`}>
            {prediction ? prediction.strategy_time_saved_fmt : '—'}
          </div>
        </div>

        <div className="telem-item strategy-visual">
          <InfoTip text="Visual representation of the optimal race strategy. The model tests all valid compound pairs (must use at least 2 different dry compounds per F1 rules) and picks the fastest split. Bar widths show stint lengths proportionally.">
            <div className="telem-label">Race Strategy</div>
          </InfoTip>
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

        <div className="telem-item circuit-picker">
          <div className="telem-label">Circuit</div>
          <select
            className="circuit-select"
            value={track}
            onChange={(e) => setTrack(e.target.value)}
          >
            {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
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
