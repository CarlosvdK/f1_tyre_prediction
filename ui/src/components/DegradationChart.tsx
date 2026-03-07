import { useMemo } from 'react';
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

const DEG_RATES: Record<string, number> = {
  soft: 0.045,
  medium: 0.028,
  hard: 0.016,
  inter: 0.035,
  wet: 0.025,
};

export default function DegradationChart({
  currentLap,
  totalLaps,
  prediction,
  compound,
}: DegradationChartProps) {
  const data = useMemo(() => {
    if (!prediction) return null;

    const paceBase = prediction.sec_per_lap_increase;
    const degRate = DEG_RATES[compound] ?? 0.028;
    const pitLap = prediction.strategy_optimal_pit_lap ?? Math.floor(totalLaps / 2);
    const c2 = prediction.strategy_stint2_compound ?? 'hard';
    const degRate2 = DEG_RATES[c2] ?? 0.016;

    const laps: number[] = [];
    const lapTimeDeltas: number[] = [];
    const tyreLife: number[] = [];
    const brakingIntensity: number[] = [];

    for (let l = 1; l <= totalLaps; l++) {
      laps.push(l);
      const inStint2 = l > pitLap;
      const stintLap = inStint2 ? l - pitLap : l;
      const rate = inStint2 ? degRate2 : degRate;

      // Lap time delta from fresh tyres (cumulative degradation)
      const delta = paceBase + rate * stintLap + 0.002 * stintLap * stintLap;
      lapTimeDeltas.push(Number(delta.toFixed(3)));

      // Tyre life remaining (%)
      const maxLife = inStint2 ? (totalLaps - pitLap) : pitLap;
      const life = Math.max(0, 100 - (stintLap / Math.max(maxLife, 1)) * 100);
      tyreLife.push(Number(life.toFixed(1)));

      // Braking intensity proxy (increases with wear)
      const brakeBase = 0.6;
      const brakeIncrease = rate * stintLap * 1.8;
      brakingIntensity.push(Number(Math.min(1, brakeBase + brakeIncrease).toFixed(3)));
    }

    return { laps, lapTimeDeltas, tyreLife, brakingIntensity, pitLap, c2 };
  }, [prediction, compound, totalLaps]);

  if (!data) {
    return (
      <div className="deg-chart-empty">
        <span>Select a circuit to view degradation</span>
      </div>
    );
  }

  const color1 = COMPOUND_COLORS[compound] ?? '#ffd400';
  const color2 = COMPOUND_COLORS[data.c2] ?? '#f5f5f7';

  return (
    <div className="deg-chart-container">
      <div className="deg-chart-header">
        <span className="deg-chart-title">Tyre Degradation</span>
        <span className="deg-chart-sub">Lap time loss &amp; tyre life over race distance</span>
      </div>
      <Plot
        data={[
          // Lap time delta - stint 1
          {
            x: data.laps.filter((l) => l <= data.pitLap),
            y: data.lapTimeDeltas.filter((_, i) => data.laps[i] <= data.pitLap),
            type: 'scatter',
            mode: 'lines',
            name: `${compound.toUpperCase()} pace loss`,
            line: { color: color1, width: 2.5 },
            yaxis: 'y',
          },
          // Lap time delta - stint 2
          {
            x: data.laps.filter((l) => l > data.pitLap),
            y: data.lapTimeDeltas.filter((_, i) => data.laps[i] > data.pitLap),
            type: 'scatter',
            mode: 'lines',
            name: `${data.c2.toUpperCase()} pace loss`,
            line: { color: color2, width: 2.5 },
            yaxis: 'y',
          },
          // Tyre life %
          {
            x: data.laps,
            y: data.tyreLife,
            type: 'scatter',
            mode: 'lines',
            name: 'Tyre life %',
            line: { color: 'rgba(54, 232, 136, 0.6)', width: 1.5, dash: 'dot' },
            yaxis: 'y2',
          },
          // Braking intensity
          {
            x: data.laps,
            y: data.brakingIntensity,
            type: 'scatter',
            mode: 'lines',
            name: 'Brake intensity',
            line: { color: 'rgba(255, 100, 80, 0.5)', width: 1.2, dash: 'dash' },
            yaxis: 'y3',
          },
          // Current lap marker
          {
            x: [currentLap],
            y: [data.lapTimeDeltas[currentLap - 1] ?? 0],
            type: 'scatter',
            mode: 'markers',
            name: 'Current',
            marker: { color: '#e10600', size: 10, line: { color: '#fff', width: 2 } },
            yaxis: 'y',
            hoverinfo: 'skip',
          },
          // Pit window
          {
            x: [data.pitLap, data.pitLap],
            y: [0, Math.max(...data.lapTimeDeltas) * 1.1],
            type: 'scatter',
            mode: 'lines',
            name: 'Pit stop',
            line: { color: 'rgba(255,255,255,0.3)', width: 1, dash: 'dash' },
            yaxis: 'y',
            hoverinfo: 'skip',
          },
        ]}
        layout={{
          autosize: true,
          margin: { l: 42, r: 42, t: 8, b: 32 },
          paper_bgcolor: 'rgba(0,0,0,0)',
          plot_bgcolor: 'rgba(0,0,0,0)',
          font: { color: 'rgba(255,255,255,0.5)', family: 'Barlow Condensed, sans-serif', size: 10 },
          xaxis: {
            title: { text: 'Lap', font: { size: 9, color: 'rgba(255,255,255,0.3)' } },
            gridcolor: 'rgba(255,255,255,0.06)',
            zerolinecolor: 'rgba(255,255,255,0.06)',
            tickfont: { size: 9 },
          },
          yaxis: {
            title: { text: 'Pace loss (s)', font: { size: 9, color: 'rgba(255,255,255,0.3)' } },
            gridcolor: 'rgba(255,255,255,0.06)',
            zerolinecolor: 'rgba(255,255,255,0.06)',
            tickfont: { size: 9 },
            side: 'left',
          },
          yaxis2: {
            overlaying: 'y',
            side: 'right',
            showgrid: false,
            range: [0, 110],
            tickfont: { size: 8, color: 'rgba(54,232,136,0.4)' },
            title: { text: 'Life %', font: { size: 8, color: 'rgba(54,232,136,0.3)' } },
          },
          yaxis3: {
            overlaying: 'y',
            side: 'right',
            showgrid: false,
            range: [0, 1.5],
            visible: false,
          },
          legend: {
            orientation: 'h',
            y: 1.08,
            x: 0.5,
            xanchor: 'center',
            font: { size: 9, color: 'rgba(255,255,255,0.45)' },
            bgcolor: 'rgba(0,0,0,0)',
          },
          hovermode: 'x unified',
          hoverlabel: {
            bgcolor: 'rgba(14,14,18,0.9)',
            bordercolor: 'rgba(255,255,255,0.15)',
            font: { size: 11, family: 'Barlow Condensed', color: '#f5f5f7' },
          },
          shapes: [
            // Pit lap annotation zone
            {
              type: 'rect',
              x0: data.pitLap - 2,
              x1: data.pitLap + 2,
              y0: 0,
              y1: 1,
              yref: 'paper',
              fillcolor: 'rgba(255,255,255,0.04)',
              line: { width: 0 },
            },
          ],
          annotations: [
            {
              x: data.pitLap,
              y: 1,
              yref: 'paper',
              text: `PIT L${data.pitLap}`,
              showarrow: false,
              font: { size: 8, color: 'rgba(255,255,255,0.5)', family: 'Barlow Condensed' },
              yanchor: 'bottom',
            },
          ],
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler
      />
    </div>
  );
}
