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

/** Get best strategy per stop count (1-stop, 2-stop, 3-stop) */
function getBestByStops(strategies: StrategyOption[]): StrategyOption[] {
  const bestByStops = new Map<number, StrategyOption>();
  for (const s of strategies) {
    const stops = s.pit_laps.length;
    if (!bestByStops.has(stops)) {
      bestByStops.set(stops, s);
    }
  }
  return Array.from(bestByStops.values())
    .sort((a, b) => a.total_time - b.total_time)
    .slice(0, 3);
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
  const topStrategies = getBestByStops(strategyData.all_strategies);
  const bestTime = topStrategies[0]?.total_time ?? 0;

  // ── TOP: Delta bar chart for best 3 strategies ──
  const barLabels = topStrategies.map((s) => {
    const compounds = s.strategy.map((c) => formatCompound(c).charAt(0)).join('-');
    return `${compounds} (${stopsLabel(s.pit_laps)})`;
  }).reverse();

  const barDeltas = topStrategies.map((s) =>
    Number((s.total_time - bestTime).toFixed(1))
  ).reverse();

  const barColors = topStrategies.map((_, i) =>
    i === 0 ? 'rgba(54, 232, 136, 0.8)' : 'rgba(255, 255, 255, 0.25)'
  ).reverse();

  const barTrace: Plotly.Data = {
    y: barLabels,
    x: barDeltas,
    type: 'bar',
    orientation: 'h',
    marker: { color: barColors },
    text: barDeltas.map((d) => d === 0 ? 'OPTIMAL' : `+${d.toFixed(1)}s`),
    textposition: 'outside',
    textfont: { color: 'rgba(255,255,255,0.7)', size: 13, family: 'Barlow Condensed' },
    hovertemplate: topStrategies.map((s) => {
      const delta = s.total_time - bestTime;
      const compounds = s.strategy.map((c) => formatCompound(c)).join(' → ');
      const pits = s.pit_laps.length > 0 ? `Pit: ${s.pit_laps.map((l) => `L${l}`).join(', ')}` : 'No pit';
      return `<b>${compounds}</b> (${stopsLabel(s.pit_laps)})<br>${pits}<br>` +
        `Total: ${s.total_time_formatted}<br>` +
        `${delta > 0 ? `+${delta.toFixed(1)}s vs optimal` : 'OPTIMAL'}<extra></extra>`;
    }).reverse(),
  };

  // ── Strategy visual bars for top 3 ──
  const strategyVisuals = topStrategies.map((s, idx) => {
    const delta = s.total_time - bestTime;
    const isBest = idx === 0;
    return (
      <div key={idx} className={`strat-compare-row${isBest ? ' best' : ''}`}>
        <div className="strat-compare-rank">{isBest ? 'BEST' : `+${delta.toFixed(1)}s`}</div>
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
        <div className="strat-compare-meta">
          {stopsLabel(s.pit_laps)}
          {s.pit_laps.length > 0 && ` · ${s.pit_laps.map((l) => `L${l}`).join(',')}`}
        </div>
      </div>
    );
  });

  // ── BOTTOM: Per-lap predicted times for optimal strategy ──
  const lapTimes = best.lap_times ?? [];
  const hasLapData = lapTimes.length > 0;

  const stintGroups: Map<number, typeof lapTimes> = new Map();
  for (const lt of lapTimes) {
    const group = stintGroups.get(lt.stint) ?? [];
    group.push(lt);
    stintGroups.set(lt.stint, group);
  }

  const firstLapTime = lapTimes.length > 0 ? lapTimes[0].time : 0;

  const lineTraces: Plotly.Data[] = [];
  for (const [, laps] of stintGroups.entries()) {
    const compound = laps[0]?.compound ?? 'MEDIUM';
    const col = COMPOUND_COLORS[compound] ?? COMPOUND_COLORS[compound.toLowerCase()] ?? '#ffd400';
    const colDim = COMPOUND_COLORS_DIM[compound] ?? COMPOUND_COLORS_DIM[compound.toLowerCase()] ?? col;

    const xVals = laps.map((l) => l.lap);
    const yVals = laps.map((l) => Number((l.time - firstLapTime).toFixed(3)));

    lineTraces.push({
      x: xVals,
      y: yVals,
      type: 'scatter',
      mode: 'lines',
      fill: 'tozeroy',
      fillcolor: colDim.replace('0.55', '0.15'),
      line: { color: col, width: 2.5 },
      name: formatCompound(compound),
      hovertemplate: laps.map((l, i) =>
        `<b>${formatCompound(compound)}</b> · Lap ${l.lap}<br>` +
        `${l.time.toFixed(2)}s (${yVals[i] >= 0 ? '+' : ''}${yVals[i].toFixed(2)}s vs L1)<br>` +
        `Tyre age: ${l.tyre_life} laps<extra></extra>`
      ),
    } as Plotly.Data);
  }

  // Pit lap vertical lines
  for (const pitLap of best.pit_laps) {
    const maxDelta = lapTimes.length > 0
      ? Math.max(...lapTimes.map((l) => l.time - firstLapTime)) * 1.1
      : 5;
    lineTraces.push({
      x: [pitLap, pitLap],
      y: [0, Math.max(maxDelta, 1)],
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
        {/* ── Top: Strategy comparison (stacked vertically) ── */}
        <div className="deg-chart-top">
          <div className="strat-compare-visual">
            {strategyVisuals}
          </div>
          <div className="strat-compare-delta-row">
            <Plot
              data={[barTrace]}
              layout={{
                autosize: true,
                margin: { l: 70, r: 50, t: 4, b: 4 },
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                bargap: 0.4,
                font: { color: 'rgba(255,255,255,0.55)', family: 'Barlow Condensed, sans-serif', size: 13 },
                xaxis: {
                  title: { text: 'Delta vs optimal (s)', font: { size: 12, color: 'rgba(255,255,255,0.4)' } },
                  gridcolor: 'rgba(255,255,255,0.06)',
                  zerolinecolor: 'rgba(54,232,136,0.3)',
                  zerolinewidth: 2,
                  tickfont: { size: 12 },
                  fixedrange: true,
                },
                yaxis: {
                  tickfont: { size: 13, color: 'rgba(255,255,255,0.7)' },
                  fixedrange: true,
                },
                showlegend: false,
                hovermode: 'closest',
                uirevision: 'bars-static',
                hoverlabel: {
                  bgcolor: 'rgba(14,14,18,0.95)',
                  bordercolor: 'rgba(255,255,255,0.15)',
                  font: { size: 14, family: 'Barlow Condensed', color: '#f5f5f7' },
                },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%', height: '100%' }}
              useResizeHandler
            />
          </div>
        </div>

        {/* ── Bottom: Per-lap pace for the fastest strategy ── */}
        <div className="deg-chart-curve">
          {hasLapData ? (
            <Plot
              data={lineTraces}
              layout={{
                autosize: true,
                margin: { l: 36, r: 8, t: 4, b: 24 },
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                font: { color: 'rgba(255,255,255,0.5)', family: 'Barlow Condensed, sans-serif', size: 13 },
                xaxis: {
                  title: { text: 'Lap', font: { size: 12, color: 'rgba(255,255,255,0.4)' } },
                  gridcolor: 'rgba(255,255,255,0.06)',
                  zerolinecolor: 'rgba(255,255,255,0.06)',
                  tickfont: { size: 11 },
                  range: [0, totalLaps + 1],
                  fixedrange: true,
                },
                yaxis: {
                  title: { text: 'Pace delta vs L1 (s)', font: { size: 12, color: 'rgba(255,255,255,0.4)' } },
                  gridcolor: 'rgba(255,255,255,0.06)',
                  zerolinecolor: 'rgba(255,255,255,0.06)',
                  tickfont: { size: 11 },
                  fixedrange: true,
                },
                legend: {
                  orientation: 'h', y: 1.18, x: 0.5, xanchor: 'center',
                  font: { size: 12, color: 'rgba(255,255,255,0.55)' },
                  bgcolor: 'rgba(0,0,0,0)',
                },
                showlegend: true,
                hovermode: 'x unified',
                uirevision: 'curve-static',
                hoverlabel: {
                  bgcolor: 'rgba(14,14,18,0.95)',
                  bordercolor: 'rgba(255,255,255,0.15)',
                  font: { size: 14, family: 'Barlow Condensed', color: '#f5f5f7' },
                },
                annotations: best.pit_laps.map((pitLap) => ({
                  x: pitLap, y: 1, yref: 'paper' as const,
                  text: `PIT L${pitLap}`,
                  showarrow: false,
                  font: { size: 12, color: 'rgba(255,255,255,0.65)', family: 'Barlow Condensed' },
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
