import { useState } from 'react';
import Plotly from 'plotly.js-basic-dist';
import createPlotlyComponent from 'react-plotly.js/factory';
import {
  type StrategyResult,
  type StrategyOption,
  COMPOUND_COLORS,
  COMPOUND_COLORS_DIM,
} from '../data/api';

const Plot = createPlotlyComponent(Plotly);

interface DegradationChartProps {
  totalLaps: number;
  strategyData: StrategyResult | null;
}

const METHOD_TEXT = [
  'How we calculate the optimal pit strategy:',
  '',
  '1. ML model predicts base lap pace per circuit/driver/team.',
  '   Trained on ~50,000 real F1 laps (2019-2024).',
  '',
  '2. Physics-based tyre degradation (non-linear, accelerating).',
  '   Circuit-specific degradation factor from TyreStress/Abrasion data.',
  '   Compound pace offsets: SOFT fastest, HARD slowest.',
  '   Fuel burn-off: cars get lighter (faster) each lap.',
  '',
  '3. Decision tree enumeration: 1-stop, 2-stop, 3-stop.',
  '   All legal compound combos tested (F1 rule: use >=2 compounds).',
  '   Pit cost from ML model + strategic overhead.',
  '',
  '4. Strategy with lowest total predicted race time wins.',
].join('\n');

function formatCompound(comp: string): string {
  return comp.charAt(0).toUpperCase() + comp.slice(1).toLowerCase();
}

function stopsLabel(pitLaps: number[]): string {
  if (pitLaps.length === 0) return 'No stop';
  if (pitLaps.length === 1) return '1-stop';
  return `${pitLaps.length}-stop`;
}

/** Get the top 3 strategies by total time, deduplicating identical compound sequences */
function getTop3(strategies: StrategyOption[]): StrategyOption[] {
  const seen = new Set<string>();
  const result: StrategyOption[] = [];
  const sorted = [...strategies].sort((a, b) => a.total_time - b.total_time);
  for (const s of sorted) {
    const key = s.strategy_str;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(s);
    if (result.length === 3) break;
  }
  return result;
}

export default function DegradationChart({
  totalLaps,
  strategyData,
}: DegradationChartProps) {
  const [showMethod, setShowMethod] = useState(false);

  if (!strategyData || !strategyData.best_strategy) {
    return (
      <div className="deg-chart-empty">
        <span>
          {strategyData === null
            ? 'Start the backend server for ML-powered strategy predictions'
            : 'No strategy data available for this circuit'}
        </span>
      </div>
    );
  }

  const best = strategyData.best_strategy;
  const topStrategies = getTop3(strategyData.all_strategies);
  const bestTime = topStrategies[0]?.total_time ?? 0;

  const RANK_LABELS = ['1st', '2nd', '3rd'];

  // ── Strategy visual bars for top 3 ──
  const strategyVisuals = topStrategies.map((s, idx) => {
    const delta = s.total_time - bestTime;
    const isBest = idx === 0;
    return (
      <div key={idx} className={`strat-compare-row${isBest ? ' best' : ''}`}>
        <div className="strat-compare-rank">{RANK_LABELS[idx]}</div>
        <div className="strat-compare-bar">
          {s.strategy.map((comp, i) => {
            const stintLaps = i === 0
              ? (s.pit_laps[0] ?? totalLaps)
              : i < s.pit_laps.length
                ? s.pit_laps[i] - s.pit_laps[i - 1]
                : totalLaps - s.pit_laps[i - 1];
            return (
              <div
                key={i}
                className="strat-compare-stint"
                style={{
                  flex: stintLaps,
                  background: COMPOUND_COLORS[comp] ?? COMPOUND_COLORS[comp.toLowerCase()] ?? '#888',
                  opacity: isBest ? 1 : 0.6,
                }}
                title={`${formatCompound(comp)} (${stintLaps}L)`}
              >
                <span className="strat-compare-label">{formatCompound(comp).charAt(0)}</span>
              </div>
            );
          })}
        </div>
        <div className="strat-compare-delta">{isBest ? '' : `+${delta.toFixed(1)}s`}</div>
      </div>
    );
  });

  // ── BOTTOM: Per-lap predicted times for optimal strategy ──
  const lapTimes = best.lap_times ?? [];
  const hasLapData = lapTimes.length > 0;

  // Apply fuel effect to get realistic predicted lap times.
  // Cars burn ~1.5 kg/lap; each kg costs ~0.035s → ~0.055s/lap.
  // Early laps are slower (heavy car), later laps faster (lighter).
  // Combined with tyre degradation this creates the classic F1 "bathtub"
  // curve within each stint, with a clear drop at each pit stop.
  const FUEL_EFFECT_PER_LAP = 0.055;
  const predictedLaps = lapTimes.map((l) => ({
    ...l,
    predicted: Number((l.time + FUEL_EFFECT_PER_LAP * (totalLaps - l.lap)).toFixed(3)),
  }));

  const allTimes = predictedLaps.map((l) => l.predicted);
  const yMin = Math.min(...allTimes);
  const yMax = Math.max(...allTimes);
  const yPad = (yMax - yMin) * 0.12;

  // Group by stint for per-stint traces
  const stintGroups: Map<number, typeof predictedLaps> = new Map();
  for (const lt of predictedLaps) {
    const group = stintGroups.get(lt.stint) ?? [];
    group.push(lt);
    stintGroups.set(lt.stint, group);
  }

  const lineTraces: Plotly.Data[] = [];
  for (const [, laps] of stintGroups.entries()) {
    const compound = laps[0]?.compound ?? 'MEDIUM';
    const col = COMPOUND_COLORS[compound] ?? COMPOUND_COLORS[compound.toLowerCase()] ?? '#ffd400';

    const xVals = laps.map((l) => l.lap);
    const yVals = laps.map((l) => l.predicted);

    lineTraces.push({
      x: xVals,
      y: yVals,
      type: 'scatter',
      mode: 'lines',
      line: { color: col, width: 2.5 },
      name: formatCompound(compound),
      hovertemplate: laps.map((l) =>
        `<b>${formatCompound(compound)}</b> · Lap ${l.lap}<br>` +
        `Predicted: ${l.predicted.toFixed(2)}s<br>` +
        `Tyre age: ${l.tyre_life} laps<extra></extra>`
      ),
    } as Plotly.Data);
  }

  // Pit lap vertical lines
  for (const pitLap of best.pit_laps) {
    lineTraces.push({
      x: [pitLap, pitLap],
      y: [yMin - yPad, yMax + yPad],
      type: 'scatter',
      mode: 'lines',
      line: { color: 'rgba(255,255,255,0.35)', width: 1.5, dash: 'dash' },
      name: `Pit L${pitLap}`,
      hoverinfo: 'skip',
      showlegend: false,
    } as Plotly.Data);
  }

  // Header info
  const stintSummary = best.strategy
    .map((c) => formatCompound(c).toUpperCase())
    .join(' → ');
  const pitLapsSummary = best.pit_laps.length > 0
    ? best.pit_laps.map((l) => `L${l}`).join(', ')
    : 'No pit';

  return (
    <div className="deg-chart-container">
      <div className="deg-chart-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="deg-chart-title">Race Strategy</span>
          <button
            type="button" className="method-toggle"
            onClick={() => setShowMethod((v) => !v)} title="How is this calculated?"
          >?</button>
        </div>
        <span className="deg-chart-sub">
          {stopsLabel(best.pit_laps)} · {strategyData.n_strategies_evaluated} strategies evaluated
        </span>
        <span className="deg-chart-sub" style={{ color: COMPOUND_COLORS[best.strategy[0]] ?? COMPOUND_COLORS[best.strategy[0]?.toLowerCase()] ?? '#fff', fontWeight: 600 }}>
          Optimal: {stintSummary} · Pit {pitLapsSummary} · {best.total_time_formatted}
        </span>
      </div>

      {showMethod && (
        <div className="method-overlay">
          <div className="method-content">
            <button type="button" className="method-close" onClick={() => setShowMethod(false)}>✕</button>
            <pre className="method-text">{METHOD_TEXT}</pre>
          </div>
        </div>
      )}

      <div className="deg-chart-panels">
        {/* ── Top: Strategy comparison (top 3) ── */}
        <div className="deg-chart-top">
          <div className="strat-compare-visual">
            {strategyVisuals}
          </div>

          <div className="strat-breakdown">
            {best.strategy.map((comp, i) => {
              const stintLaps = i === 0
                ? (best.pit_laps[0] ?? totalLaps)
                : i < best.pit_laps.length
                  ? best.pit_laps[i] - best.pit_laps[i - 1]
                  : totalLaps - best.pit_laps[i - 1];
              const stintTime = best.stint_times[i];
              const mins = Math.floor(stintTime / 60);
              const secs = (stintTime % 60).toFixed(1);
              return (
                <div key={i} className="strat-breakdown-row">
                  <span
                    className="strat-breakdown-dot"
                    style={{ background: COMPOUND_COLORS[comp] ?? COMPOUND_COLORS[comp.toLowerCase()] ?? '#888' }}
                  />
                  <span className="strat-breakdown-compound">{formatCompound(comp)}</span>
                  <span className="strat-breakdown-detail">{stintLaps}L</span>
                  <span className="strat-breakdown-detail">{mins}:{secs.padStart(4, '0')}</span>
                  {i < best.pit_laps.length && (
                    <span className="strat-breakdown-pit">Pit L{best.pit_laps[i]}</span>
                  )}
                </div>
              );
            })}
            <div className="strat-breakdown-total">
              Total: {best.total_time_formatted}
              {best.pit_costs.length > 0 && (
                <span> · Pit cost: {best.pit_costs.reduce((a, b) => a + b, 0).toFixed(1)}s</span>
              )}
            </div>
          </div>
        </div>

        {/* ── Bottom: Per-lap pace for the fastest strategy ── */}
        <div className="deg-chart-curve">
          {hasLapData ? (
            <Plot
              data={lineTraces}
              layout={{
                autosize: true,
                margin: { l: 48, r: 8, t: 4, b: 24 },
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                font: { color: 'rgba(255,255,255,0.5)', family: 'Barlow Condensed, sans-serif', size: 15 },
                xaxis: {
                  title: { text: 'Lap', font: { size: 14, color: 'rgba(255,255,255,0.4)' } },
                  gridcolor: 'rgba(255,255,255,0.06)',
                  zerolinecolor: 'rgba(255,255,255,0.06)',
                  tickfont: { size: 13 },
                  range: [0, totalLaps + 1],
                  fixedrange: true,
                },
                yaxis: {
                  title: { text: 'Lap time (s)', font: { size: 14, color: 'rgba(255,255,255,0.4)' } },
                  gridcolor: 'rgba(255,255,255,0.06)',
                  zerolinecolor: 'rgba(255,255,255,0.06)',
                  tickfont: { size: 13 },
                  fixedrange: true,
                  range: [yMin - yPad, yMax + yPad],
                },
                legend: {
                  orientation: 'h', y: 1.18, x: 0.5, xanchor: 'center',
                  font: { size: 14, color: 'rgba(255,255,255,0.55)' },
                  bgcolor: 'rgba(0,0,0,0)',
                },
                showlegend: true,
                hovermode: 'x unified',
                uirevision: 'curve-static',
                hoverlabel: {
                  bgcolor: 'rgba(14,14,18,0.95)',
                  bordercolor: 'rgba(255,255,255,0.15)',
                  font: { size: 16, family: 'Barlow Condensed', color: '#f5f5f7' },
                },
                annotations: best.pit_laps.map((pitLap) => ({
                  x: pitLap, y: 1, yref: 'paper' as const,
                  text: `PIT L${pitLap}`,
                  showarrow: false,
                  font: { size: 14, color: 'rgba(255,255,255,0.65)', family: 'Barlow Condensed' },
                  yanchor: 'bottom' as const,
                })),
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%', height: '100%' }}
              useResizeHandler
            />
          ) : (
            <div className="deg-chart-empty" style={{ fontSize: '0.85rem' }}>
              <span>Per-lap predictions available when backend is running</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
