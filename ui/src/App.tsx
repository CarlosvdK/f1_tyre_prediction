import { useEffect, useMemo, useRef, useState } from 'react';
import CarViewer from './components/CarViewer';
import DegradationChart from './components/DegradationChart';
import InfoTip from './components/InfoTip';
import TrackMap from './components/TrackMap';
import {
  getOptimalStrategy,
  getPredictions,
  getTelemetry,
  listDrivers,
  listLaps,
  listTracks,
  defaultLapCount,
  type Compound,
  type Prediction,
  type StrategyResult,
  type TelemetryPoint,
  type Track,
  type TrackCondition,
  COMPOUND_COLORS,
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

function formatCompound(comp: string): string {
  return comp.charAt(0).toUpperCase() + comp.slice(1).toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toCompound(value: string | undefined | null): Compound | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === 'soft' || normalized === 'medium' || normalized === 'hard' || normalized === 'inter' || normalized === 'wet') {
    return normalized;
  }
  if (normalized === 'intermediate') return 'inter';
  return null;
}

const EXPECTED_TYRE_LIFE: Record<Compound, number> = {
  soft: 18,
  medium: 28,
  hard: 40,
  inter: 24,
  wet: 30,
};

function buildWearFromStint(compound: Compound, lapsOnTyre: number) {
  const expectedLife = EXPECTED_TYRE_LIFE[compound] ?? 28;
  const progress = clamp(lapsOnTyre / Math.max(expectedLife, 1), 0, 1);
  const curve = Math.pow(progress, compound === 'soft' ? 1.08 : compound === 'hard' ? 1.34 : 1.2);
  const baseWear = clamp(0.05 + (curve * 0.88), 0.03, 0.98);
  const frontBias = compound === 'soft' ? 0.06 : 0.04;
  const rearBias = compound === 'hard' ? -0.03 : -0.015;

  return {
    tyreLifePct: clamp(100 - (curve * 100), 3, 100),
    wear: {
      wear_FL: clamp(baseWear + frontBias + 0.018, 0.03, 0.99),
      wear_FR: clamp(baseWear + frontBias + 0.036, 0.03, 0.99),
      wear_RL: clamp(baseWear + rearBias - 0.02, 0.03, 0.97),
      wear_RR: clamp(baseWear + rearBias, 0.03, 0.98),
    },
  };
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
  const [strategyData, setStrategyData] = useState<StrategyResult | null>(null);
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

  // Fetch strategy when track changes (pre-race prediction, not lap-dependent)
  useEffect(() => {
    if (!track) return;
    let alive = true;
    const totalLaps = defaultLapCount(track);
    getOptimalStrategy(track, totalLaps)
      .then((result) => {
        if (!alive) return;
        setStrategyData(result);
      })
      .catch(() => {
        if (alive) setStrategyData(null);
      });
    return () => { alive = false; };
  }, [track]);

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

  // Derive strategy info from strategyData (backend ML) for the bottom strip
  const best = strategyData?.best_strategy ?? null;
  const stintInfo = best ? best.strategy.map((comp, i) => {
    const startLap = i === 0 ? 1 : best.pit_laps[i - 1] + 1;
    const endLap = i < best.pit_laps.length ? best.pit_laps[i] : (strategyData?.total_laps ?? maxLap);
    return { compound: comp, laps: endLap - startLap + 1 };
  }) : null;

  // Determine which stint the current lap is in
  const currentStint = best ? (() => {
    for (let i = 0; i < best.pit_laps.length; i++) {
      if (lap <= best.pit_laps[i]) return i + 1;
    }
    return best.strategy.length;
  })() : 1;

  const stintLapNum = best
    ? (currentStint === 1 ? lap : lap - best.pit_laps[currentStint - 2])
    : lap;

  const viewerTyreState = useMemo(() => {
    if (best) {
      const lapSnapshot = best.lap_times?.find((item) => item.lap === lap);
      const strategyCompound = toCompound(
        lapSnapshot?.compound ?? best.strategy[currentStint - 1] ?? MODEL_COMPOUND,
      ) ?? MODEL_COMPOUND;
      const lapsOnTyre = Math.max(1, lapSnapshot?.tyre_life ?? stintLapNum);
      const visualWear = buildWearFromStint(strategyCompound, lapsOnTyre);

      return {
        compound: strategyCompound,
        lapsOnTyre,
        tyreLifePct: visualWear.tyreLifePct,
        wear: visualWear.wear,
      };
    }

    const fallbackWear = {
      wear_FL: prediction?.wear_FL ?? 0.2,
      wear_FR: prediction?.wear_FR ?? 0.2,
      wear_RL: prediction?.wear_RL ?? 0.2,
      wear_RR: prediction?.wear_RR ?? 0.2,
    };
    const fallbackCompound = toCompound(prediction?.strategy_stint1_compound) ?? MODEL_COMPOUND;

    return {
      compound: fallbackCompound,
      lapsOnTyre: lap,
      tyreLifePct: prediction?.tyre_life_pct ?? 100 - ((((fallbackWear.wear_FL + fallbackWear.wear_FR + fallbackWear.wear_RL + fallbackWear.wear_RR) / 4) * 100)),
      wear: fallbackWear,
    };
  }, [MODEL_COMPOUND, best, currentStint, lap, prediction, stintLapNum]);

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div className="f1-app">

      {/* ═════════════════════════════════════��═════════════════════
          FULL-BLEED SCENE SHELL
          ═══════════════════════════════════════════════════════════ */}
      <div className="scene-shell">

        {/* Full-bleed 3D */}
        <CarViewer
          compound={viewerTyreState.compound}
          wear={viewerTyreState.wear}
          prediction={prediction}
          currentLap={lap}
          lapsOnTire={viewerTyreState.lapsOnTyre}
          tyreLifePct={viewerTyreState.tyreLifePct}
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
                totalLaps={maxLap}
                strategyData={strategyData}
              />
            </div>
          </section>

          <section className="scene-glass-card scene-map-card">
            <header className="scene-card-head">
              <div>
                <InfoTip text="Shows predicted braking and acceleration zones around the circuit for the current lap. As tyres degrade, braking zones grow longer (thicker red lines) because the driver must brake earlier with less grip. Acceleration zones shrink (thinner green lines) as traction reduces. Compare against the faint fresh-tyre braking outline to see the degradation effect. Hover over any zone for details.">
                  <h2 className="scene-card-title">Braking &amp; Acceleration Map</h2>
                </InfoTip>
                <p className="scene-card-sub">Lap {lap} · Stint {currentStint} · Stint lap {stintLapNum}</p>
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
          BOTTOM TELEMETRY STRIP
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
          <InfoTip text="The model-recommended pit lap(s). Computed by the ML strategy optimizer which evaluates all valid compound combinations (1-stop, 2-stop, 3-stop) and selects the one that minimises total predicted race time.">
            <div className="telem-label">Optimal Pit{best && best.pit_laps.length > 1 ? 's' : ''}</div>
          </InfoTip>
          <div className={`telem-value${!best && !prediction ? ' loading' : ''}`}>
            {best ? (
              <>
                {best.pit_laps.map((l) => `L${l}`).join(', ')}
                <span className="telem-unit">({best.pit_laps.length}-stop)</span>
              </>
            ) : prediction ? (
              <>
                Lap {prediction.strategy_optimal_pit_lap}
                <span className="telem-unit">({prediction.strategy_stint1_laps}+{prediction.strategy_stint2_laps})</span>
              </>
            ) : '—'}
          </div>
        </div>

        <div className="telem-item">
          <InfoTip text="Total predicted race time for the optimal strategy. Computed by the ML model summing predicted lap times for each stint plus pit stop costs.">
            <div className="telem-label">Race Time</div>
          </InfoTip>
          <div className={`telem-value${!best && !prediction ? ' loading' : ''}`}>
            {best ? best.total_time_formatted : prediction?.strategy_time_saved_fmt ?? '—'}
          </div>
        </div>

        <div className="telem-item strategy-visual">
          <InfoTip text="Visual representation of the optimal race strategy from ML model predictions. Supports 1-stop, 2-stop, and 3-stop strategies. Bar widths show stint lengths proportionally.">
            <div className="telem-label">Race Strategy</div>
          </InfoTip>
          <div className={`strategy-bar${!best && !prediction ? ' loading' : ''}`}>
            {stintInfo ? (
              stintInfo.map((stint, i) => (
                <div
                  key={i}
                  className={`strat-stint bg-${stint.compound.toLowerCase()}`}
                  style={{
                    flex: stint.laps,
                    background: COMPOUND_COLORS[stint.compound] ?? COMPOUND_COLORS[stint.compound.toLowerCase()] ?? '#888',
                  }}
                  title={`${formatCompound(stint.compound)} (${stint.laps} laps)`}
                ></div>
              ))
            ) : prediction ? (
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
            {stintInfo ? (
              stintInfo.map((stint, i) => (
                <span key={i}>
                  {i > 0 && <span style={{ margin: '0 2px' }}>→</span>}
                  {formatCompound(stint.compound).toUpperCase()}
                </span>
              ))
            ) : prediction ? (
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
