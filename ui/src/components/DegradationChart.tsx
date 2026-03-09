import { useMemo, useState } from 'react';
import Plotly from 'plotly.js-basic-dist';
import createPlotlyComponent from 'react-plotly.js/factory';
import type { Prediction, Compound } from '../data/api';

const Plot = createPlotlyComponent(Plotly);

interface DegradationChartProps {
  currentLap: number;
  totalLaps: number;
  prediction: Prediction | null;
  compound: Compound;
}

const COMPOUND_COLORS: Record<string, string> = {
  soft: '#e10600',
  medium: '#ffd400',
  hard: '#f5f5f7',
  inter: '#00a442',
  wet: '#0077c8',
};

const COMPOUND_COLORS_DIM: Record<string, string> = {
  soft: 'rgba(225,6,0,0.55)',
  medium: 'rgba(255,212,0,0.55)',
  hard: 'rgba(245,245,247,0.55)',
  inter: 'rgba(0,164,66,0.55)',
  wet: 'rgba(0,119,200,0.55)',
};

const DEG_RATES: Record<string, number> = {
  soft: 0.045,
  medium: 0.028,
  hard: 0.016,
  inter: 0.035,
  wet: 0.025,
};

const PIT_COST_SECONDS = 24.5;

interface StrategyResult {
  c1: string;
  c2: string;
  pitLap: number;
  /** Total race time (all laps + pit cost) */
  totalTime: number;
  /** Degradation loss stint 1 only */
  degStint1: number;
  /** Degradation loss stint 2 only */
  degStint2: number;
  /** Per-lap pace delta vs fresh tyre */
  deltas: number[];
  label: string;
}

function evaluateStrategies(totalLaps: number, basePace: number): StrategyResult[] {
  const compounds = ['soft', 'medium', 'hard'];
  const results: StrategyResult[] = [];

  for (const c1 of compounds) {
    for (const c2 of compounds) {
      if (c1 === c2) continue;
      const r1 = DEG_RATES[c1], r2 = DEG_RATES[c2];

      let bestPit = Math.floor(totalLaps / 2);
      let bestTotal = Infinity;
      let bestDeg1 = 0, bestDeg2 = 0;
      let bestDeltas: number[] = [];

      for (let pit = 5; pit <= totalLaps - 5; pit++) {
        const deltas: number[] = [];
        let total = PIT_COST_SECONDS;
        let deg1 = 0, deg2 = 0;

        for (let l = 1; l <= totalLaps; l++) {
          const stint2 = l > pit;
          const sl = stint2 ? l - pit : l;
          const rate = stint2 ? r2 : r1;
          const delta = rate * sl + 0.002 * sl * sl;
          deltas.push(delta);
          total += basePace + delta;
          if (stint2) deg2 += delta; else deg1 += delta;
        }

        if (total < bestTotal) {
          bestTotal = total; bestPit = pit;
          bestDeg1 = deg1; bestDeg2 = deg2;
          bestDeltas = deltas;
        }
      }

      results.push({
        c1, c2, pitLap: bestPit, totalTime: bestTotal,
        degStint1: bestDeg1, degStint2: bestDeg2,
        deltas: bestDeltas,
        label: `${c1[0].toUpperCase()} → ${c2[0].toUpperCase()}`,
      });
    }
  }

  results.sort((a, b) => a.totalTime - b.totalTime);
  return results;
}

const METHOD_TEXT = [
  'How we calculate the optimal pit strategy:',
  '',
  '1. Model lap time per compound',
  '   Each compound has a degradation rate:',
  '   SOFT = 0.045s/lap · MEDIUM = 0.028s/lap · HARD = 0.016s/lap',
  '   Per-lap loss: delta = rate × stint_lap + 0.002 × stint_lap²',
  '',
  '2. Test every valid 2-compound combination',
  '   F1 rules require at least 2 different dry compounds.',
  '   We evaluate all 6 possible pairs.',
  '',
  '3. Sweep every possible pit lap (5 to totalLaps−5)',
  '   For each pair + pit lap, sum predicted lap times + 24.5s pit cost.',
  '',
  '4. The combo with the lowest total race time wins.',
  '',
  'Bar chart: Total degradation cost per strategy.',
  'Curve: Per-lap pace loss for the optimal strategy —',
  'notice the drop at the pit lap when fresh tyres go on.',
].join('\n');

export default function DegradationChart({
  currentLap: _currentLap,
  totalLaps,
  prediction,
  compound,
}: DegradationChartProps) {
  const [showMethod, setShowMethod] = useState(false);

  // Strategy is a PRE-RACE prediction — computed once from track/compound,
  // not from the current lap's degradation reading. Use a fixed base pace.
  const data = useMemo(() => {
    if (!prediction) return null;

    const basePace = 80; // fixed representative lap time — strategy ranking is independent of this
    const strategies = evaluateStrategies(totalLaps, basePace);
    const top6 = strategies.slice(0, 6);

    const optLabel = prediction.strategy_stint1_compound && prediction.strategy_stint2_compound
      ? `${prediction.strategy_stint1_compound[0].toUpperCase()} → ${prediction.strategy_stint2_compound[0].toUpperCase()}`
      : top6[0]?.label ?? '';

    // No-stop baseline
    const noStopRate = DEG_RATES[compound] ?? 0.028;
    let noStopDeg = 0;
    for (let l = 1; l <= totalLaps; l++) noStopDeg += noStopRate * l + 0.002 * l * l;

    return { top6, optLabel, noStopDeg };
    // Only depends on totalLaps and compound — NOT on prediction values that change per lap
  }, [totalLaps, compound, prediction?.strategy_stint1_compound, prediction?.strategy_stint2_compound]);

  if (!data) {
    return (
      <div className="deg-chart-empty">
        <span>Select a circuit to view strategy</span>
      </div>
    );
  }

  const { top6, optLabel } = data;
  const optimal = top6[0];
  const laps = Array.from({ length: totalLaps }, (_, i) => i + 1);

  // ── BAR CHART DATA: horizontal stacked bars ──
  // Each strategy: stint1 deg (colored) + pit cost (gray) + stint2 deg (colored)
  const barLabels = top6.map((s) => s.label).reverse(); // reverse for bottom-up
  const stint1Vals = top6.map((s) => Number(s.degStint1.toFixed(1))).reverse();
  const pitVals = top6.map(() => PIT_COST_SECONDS).reverse();
  const stint2Vals = top6.map((s) => Number(s.degStint2.toFixed(1))).reverse();
  const stint1Colors = top6.map((s) => COMPOUND_COLORS_DIM[s.c1] ?? 'rgba(255,212,0,0.55)').reverse();
  const stint2Colors = top6.map((s) => COMPOUND_COLORS_DIM[s.c2] ?? 'rgba(245,245,247,0.55)').reverse();

  // Identify optimal index in reversed array
  const optIdxReversed = barLabels.indexOf(optLabel);

  // Build bar border to highlight optimal
  const barBorders = barLabels.map((_, i) =>
    i === optIdxReversed ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0)'
  );

  const barTraces: Plotly.Data[] = [
    {
      y: barLabels, x: stint1Vals,
      type: 'bar', orientation: 'h', name: 'Stint 1 deg',
      marker: { color: stint1Colors, line: { color: barBorders, width: barLabels.map((_, i) => i === optIdxReversed ? 2 : 0) } },
      hovertemplate: barLabels.map((label, i) =>
        `<b>${label}</b><br>Stint 1 degradation: ${stint1Vals[i]}s<extra></extra>`
      ),
    } as Plotly.Data,
    {
      y: barLabels, x: pitVals,
      type: 'bar', orientation: 'h', name: 'Pit stop cost',
      marker: { color: 'rgba(140,140,160,0.25)' },
      hovertemplate: barLabels.map((label) =>
        `<b>${label}</b><br>Pit stop: ${PIT_COST_SECONDS}s<extra></extra>`
      ),
    } as Plotly.Data,
    {
      y: barLabels, x: stint2Vals,
      type: 'bar', orientation: 'h', name: 'Stint 2 deg',
      marker: { color: stint2Colors, line: { color: barBorders, width: barLabels.map((_, i) => i === optIdxReversed ? 2 : 0) } },
      hovertemplate: barLabels.map((label, i) =>
        `<b>${label}</b><br>Stint 2 degradation: ${stint2Vals[i]}s<extra></extra>`
      ),
    } as Plotly.Data,
  ];

  // ── LINE CHART DATA: optimal strategy pace loss curve ──
  const col1 = COMPOUND_COLORS[optimal.c1] ?? '#ffd400';
  const col2 = COMPOUND_COLORS[optimal.c2] ?? '#f5f5f7';
  const col1Dim = COMPOUND_COLORS_DIM[optimal.c1] ?? col1;
  const col2Dim = COMPOUND_COLORS_DIM[optimal.c2] ?? col2;

  const s1Laps = laps.filter((l) => l <= optimal.pitLap);
  const s1Deltas = optimal.deltas.filter((_, i) => laps[i] <= optimal.pitLap);
  const s2Laps = laps.filter((l) => l > optimal.pitLap);
  const s2Deltas = optimal.deltas.filter((_, i) => laps[i] > optimal.pitLap);

  // Fill area under curve for visual impact
  const lineTraces: Plotly.Data[] = [
    // Stint 1 filled area
    {
      x: s1Laps, y: s1Deltas,
      type: 'scatter', mode: 'lines',
      fill: 'tozeroy', fillcolor: col1Dim.replace('0.55', '0.15'),
      line: { color: col1, width: 2.5 },
      name: `${optimal.c1.toUpperCase()}`,
      hovertemplate: s1Laps.map((l, i) =>
        `<b>${optimal.c1.toUpperCase()}</b> · Lap ${l}<br>+${s1Deltas[i].toFixed(2)}s vs fresh<extra></extra>`
      ),
    } as Plotly.Data,
    // Stint 2 filled area
    {
      x: s2Laps, y: s2Deltas,
      type: 'scatter', mode: 'lines',
      fill: 'tozeroy', fillcolor: col2Dim.replace('0.55', '0.15'),
      line: { color: col2, width: 2.5 },
      name: `${optimal.c2.toUpperCase()}`,
      hovertemplate: s2Laps.map((_l, i) =>
        `<b>${optimal.c2.toUpperCase()}</b> · Stint lap ${s2Laps[i] - optimal.pitLap}<br>+${s2Deltas[i].toFixed(2)}s vs fresh<extra></extra>`
      ),
    } as Plotly.Data,
    // Pit vertical
    {
      x: [optimal.pitLap, optimal.pitLap],
      y: [0, Math.max(...optimal.deltas) * 1.1],
      type: 'scatter', mode: 'lines',
      line: { color: 'rgba(255,255,255,0.35)', width: 1.5, dash: 'dash' },
      name: 'Pit', hoverinfo: 'skip',
    } as Plotly.Data,
  ];

  const totalCost = optimal.degStint1 + optimal.degStint2 + PIT_COST_SECONDS;
  const noStopCost = data.noStopDeg;
  const timeSaved = noStopCost - totalCost;

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
          Total time lost per strategy — stint degradation + pit cost
        </span>
        <span className="deg-chart-sub" style={{ color: COMPOUND_COLORS[optimal.c1] ?? '#fff', fontWeight: 600 }}>
          Optimal: {optimal.c1.toUpperCase()} → {optimal.c2.toUpperCase()} · Pit L{optimal.pitLap} · Saves {timeSaved.toFixed(1)}s vs no-stop
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

      {/* Two-panel layout: bar chart top, curve bottom */}
      <div className="deg-chart-panels">
        {/* ── Bar chart: strategy comparison ── */}
        <div className="deg-chart-bars">
          <Plot
            data={barTraces}
            layout={{
              autosize: true,
              margin: { l: 48, r: 12, t: 4, b: 4 },
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor: 'rgba(0,0,0,0)',
              barmode: 'stack',
              bargap: 0.45,
              font: { color: 'rgba(255,255,255,0.55)', family: 'Barlow Condensed, sans-serif', size: 10 },
              xaxis: {
                title: { text: 'Total time cost (s)', font: { size: 10, color: 'rgba(255,255,255,0.35)' } },
                gridcolor: 'rgba(255,255,255,0.06)',
                zerolinecolor: 'rgba(255,255,255,0.06)',
                tickfont: { size: 9 },
                fixedrange: true,
              },
              yaxis: {
                tickfont: { size: 11, color: 'rgba(255,255,255,0.7)' },
                fixedrange: true,
              },
              legend: {
                orientation: 'h', y: 1.15, x: 0.5, xanchor: 'center',
                font: { size: 9, color: 'rgba(255,255,255,0.5)' },
                bgcolor: 'rgba(0,0,0,0)',
              },
              showlegend: true,
              hovermode: 'closest',
              uirevision: 'bars-static',
              hoverlabel: {
                bgcolor: 'rgba(14,14,18,0.95)',
                bordercolor: 'rgba(255,255,255,0.15)',
                font: { size: 11, family: 'Barlow Condensed', color: '#f5f5f7' },
              },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler
          />
        </div>

        {/* ── Line chart: optimal strategy pace curve ── */}
        <div className="deg-chart-curve">
          <Plot
            data={lineTraces}
            layout={{
              autosize: true,
              margin: { l: 36, r: 8, t: 4, b: 24 },
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor: 'rgba(0,0,0,0)',
              font: { color: 'rgba(255,255,255,0.5)', family: 'Barlow Condensed, sans-serif', size: 10 },
              xaxis: {
                title: { text: 'Lap', font: { size: 9, color: 'rgba(255,255,255,0.3)' } },
                gridcolor: 'rgba(255,255,255,0.06)',
                zerolinecolor: 'rgba(255,255,255,0.06)',
                tickfont: { size: 8 },
                range: [0, totalLaps + 1],
                fixedrange: true,
              },
              yaxis: {
                title: { text: 'Pace loss (s)', font: { size: 9, color: 'rgba(255,255,255,0.3)' } },
                gridcolor: 'rgba(255,255,255,0.06)',
                zerolinecolor: 'rgba(255,255,255,0.06)',
                tickfont: { size: 8 },
                fixedrange: true,
                rangemode: 'tozero',
              },
              legend: {
                orientation: 'h', y: 1.18, x: 0.5, xanchor: 'center',
                font: { size: 9, color: 'rgba(255,255,255,0.5)' },
                bgcolor: 'rgba(0,0,0,0)',
              },
              showlegend: true,
              hovermode: 'x unified',
              uirevision: 'curve-static',
              hoverlabel: {
                bgcolor: 'rgba(14,14,18,0.95)',
                bordercolor: 'rgba(255,255,255,0.15)',
                font: { size: 11, family: 'Barlow Condensed', color: '#f5f5f7' },
              },
              annotations: [{
                x: optimal.pitLap, y: 1, yref: 'paper',
                text: `PIT L${optimal.pitLap}`,
                showarrow: false,
                font: { size: 9, color: 'rgba(255,255,255,0.6)', family: 'Barlow Condensed' },
                yanchor: 'bottom',
              }],
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler
          />
        </div>
      </div>
    </div>
  );
}
