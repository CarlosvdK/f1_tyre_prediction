import { useEffect, useMemo, useState } from 'react';
import Plotly from 'plotly.js-basic-dist';
import createPlotlyComponent from 'react-plotly.js/factory';
import type { FeatureKey, TelemetryPoint, ThemeMode, XYPoint } from '../data/api';

const Plot = createPlotlyComponent(Plotly);
const RESAMPLE_POINTS = 1800;

interface TrackMapProps {
  outline: XYPoint[];
  telemetry: TelemetryPoint[];
  baselineTelemetry: TelemetryPoint[];
  feature: FeatureKey;
  theme: ThemeMode;
}

interface Transform {
  cx: number;
  cy: number;
  scale: number;
}

function hasValidXY(points: XYPoint[]): boolean {
  if (points.length < 12) {
    return false;
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  const ySpan = Math.max(...ys) - Math.min(...ys);
  return xSpan > 1e-3 && ySpan > 1e-3;
}

function cumulativeDistance(points: XYPoint[]): number[] {
  const d = new Array<number>(points.length).fill(0);
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    d[i] = d[i - 1] + Math.hypot(dx, dy);
  }
  return d;
}

function resampleTelemetry(points: TelemetryPoint[], targetCount: number): TelemetryPoint[] {
  if (points.length < 3 || targetCount <= points.length) {
    return points;
  }
  const dist = cumulativeDistance(points);
  const total = dist[dist.length - 1];
  if (!Number.isFinite(total) || total < 1e-6) {
    return points;
  }

  const out: TelemetryPoint[] = [];
  let idx = 0;
  for (let i = 0; i < targetCount; i += 1) {
    const t = (total * i) / (targetCount - 1);
    while (idx < dist.length - 2 && dist[idx + 1] < t) {
      idx += 1;
    }
    const left = points[idx];
    const right = points[idx + 1];
    const span = Math.max(dist[idx + 1] - dist[idx], 1e-9);
    const ratio = (t - dist[idx]) / span;
    out.push({
      x: left.x + (right.x - left.x) * ratio,
      y: left.y + (right.y - left.y) * ratio,
      speed: left.speed + (right.speed - left.speed) * ratio,
      brake: left.brake + (right.brake - left.brake) * ratio,
      throttle: left.throttle + (right.throttle - left.throttle) * ratio,
    });
  }
  return out;
}

function resampleOutline(points: XYPoint[], targetCount: number): XYPoint[] {
  if (points.length < 3 || targetCount <= points.length) {
    return points;
  }
  const dist = cumulativeDistance(points);
  const total = dist[dist.length - 1];
  if (!Number.isFinite(total) || total < 1e-6) {
    return points;
  }

  const out: XYPoint[] = [];
  let idx = 0;
  for (let i = 0; i < targetCount; i += 1) {
    const t = (total * i) / (targetCount - 1);
    while (idx < dist.length - 2 && dist[idx + 1] < t) {
      idx += 1;
    }
    const left = points[idx];
    const right = points[idx + 1];
    const span = Math.max(dist[idx + 1] - dist[idx], 1e-9);
    const ratio = (t - dist[idx]) / span;
    out.push({
      x: left.x + (right.x - left.x) * ratio,
      y: left.y + (right.y - left.y) * ratio,
    });
  }
  return out;
}

function smoothTelemetry(points: TelemetryPoint[], windowSize = 9): TelemetryPoint[] {
  if (points.length < 5) {
    return points;
  }
  const half = Math.floor(windowSize / 2);
  return points.map((_, index) => {
    let x = 0;
    let y = 0;
    let speed = 0;
    let brake = 0;
    let throttle = 0;
    let count = 0;
    for (let j = -half; j <= half; j += 1) {
      const idx = (index + j + points.length) % points.length;
      const p = points[idx];
      x += p.x;
      y += p.y;
      speed += p.speed;
      brake += p.brake;
      throttle += p.throttle;
      count += 1;
    }
    return {
      x: x / count,
      y: y / count,
      speed: speed / count,
      brake: brake / count,
      throttle: throttle / count,
    };
  });
}

function smoothOutline(points: XYPoint[], windowSize = 9): XYPoint[] {
  if (points.length < 5) {
    return points;
  }
  const half = Math.floor(windowSize / 2);
  return points.map((_, index) => {
    let x = 0;
    let y = 0;
    let count = 0;
    for (let j = -half; j <= half; j += 1) {
      const idx = (index + j + points.length) % points.length;
      x += points[idx].x;
      y += points[idx].y;
      count += 1;
    }
    return { x: x / count, y: y / count };
  });
}

function getTransform(points: XYPoint[]): Transform {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = Math.max(maxX - minX, maxY - minY) / 2 || 1;
  return { cx, cy, scale };
}

function normalizePoint(p: XYPoint, t: Transform): XYPoint {
  return {
    x: ((p.x - t.cx) / t.scale) * 100,
    y: ((p.y - t.cy) / t.scale) * 100,
  };
}

function averageSpeed(points: TelemetryPoint[]): number {
  if (points.length === 0) {
    return 0;
  }
  return points.reduce((total, item) => total + item.speed, 0) / points.length;
}

function computeFeatureDelta(
  feature: FeatureKey,
  current: TelemetryPoint,
  baseline: TelemetryPoint,
  avgSpeed: number,
): number {
  switch (feature) {
    case 'braking_earlier_delta':
      return current.brake - baseline.brake;
    case 'lower_corner_speed_delta':
      return baseline.speed - current.speed;
    case 'throttle_delay_delta':
      return baseline.throttle - current.throttle;
    case 'degradation_intensity_proxy': {
      const speedPenalty = Math.max(0, (avgSpeed - current.speed) / Math.max(avgSpeed, 1));
      return (speedPenalty * 0.7) + current.brake * 0.45 - current.throttle * 0.3;
    }
    default:
      return 0;
  }
}

function fallbackSectorValues(points: TelemetryPoint[]): number[] {
  if (points.length === 0) {
    return [0, 0, 0];
  }
  const buckets: number[][] = [[], [], []];
  points.forEach((point, idx) => {
    const sec = Math.min(2, Math.floor((idx / points.length) * 3));
    const v = point.brake * 0.7 + (1 - point.throttle) * 0.45;
    buckets[sec].push(v);
  });
  return buckets.map((b) => (b.length ? b.reduce((a, c) => a + c, 0) / b.length : 0));
}

export default function TrackMap({
  outline,
  telemetry,
  baselineTelemetry,
  feature,
  theme,
}: TrackMapProps) {
  const [fadeIn, setFadeIn] = useState(true);
  const [playhead, setPlayhead] = useState(0);

  const prepared = useMemo(() => {
    const safeBase = baselineTelemetry.length > 0 ? baselineTelemetry : telemetry;
    const currentResampled = smoothTelemetry(resampleTelemetry(telemetry, RESAMPLE_POINTS));
    const baselineResampled = smoothTelemetry(resampleTelemetry(safeBase, RESAMPLE_POINTS));
    const outlineResampled = smoothOutline(resampleOutline(outline, 900));

    const mergedOutline = outlineResampled.map((point, idx) => {
      const a = baselineResampled[idx % Math.max(baselineResampled.length, 1)];
      const b = currentResampled[idx % Math.max(currentResampled.length, 1)];
      if (!a || !b) {
        return point;
      }
      return {
        x: point.x * 0.58 + a.x * 0.22 + b.x * 0.2,
        y: point.y * 0.58 + a.y * 0.22 + b.y * 0.2,
      };
    });

    const hasTelemetry = hasValidXY(currentResampled);
    const hasOutline = hasValidXY(mergedOutline);
    const transform = getTransform(hasOutline ? mergedOutline : currentResampled);

    const normalizedOutline = mergedOutline.map((p) => normalizePoint(p, transform));
    const normalizedCurrent = currentResampled.map((p) => normalizePoint(p, transform));
    const normalizedBaseline = baselineResampled.map((p) => normalizePoint(p, transform));
    const avgSpeed = averageSpeed(currentResampled);

    const z = currentResampled.map((point, index) => {
      const baseline = baselineResampled[index % baselineResampled.length] ?? point;
      return computeFeatureDelta(feature, point, baseline, avgSpeed);
    });

    const brakeScores = currentResampled.map((point) => point.brake);
    const sorted = [...brakeScores].sort((a, b) => a - b);
    const threshold = sorted[Math.max(0, Math.floor(sorted.length * 0.86))] ?? 0.75;
    const brakingZones = currentResampled
      .map((point, index) => ({ point, index }))
      .filter((item) => item.point.brake >= threshold)
      .filter((_, index) => index % 12 === 0);

    return {
      hasTelemetry,
      normalizedOutline,
      normalizedCurrent,
      normalizedBaseline,
      z,
      brakingZones,
      fallbackSectors: fallbackSectorValues(currentResampled),
    };
  }, [outline, telemetry, baselineTelemetry, feature]);

  useEffect(() => {
    setFadeIn(false);
    const id = window.setTimeout(() => setFadeIn(true), 30);
    return () => window.clearTimeout(id);
  }, [feature, telemetry, baselineTelemetry]);

  useEffect(() => {
    if (!prepared.hasTelemetry || prepared.normalizedCurrent.length === 0) {
      return;
    }
    const id = window.setInterval(() => {
      setPlayhead((index) => (index + 8) % prepared.normalizedCurrent.length);
    }, 120);
    return () => window.clearInterval(id);
  }, [prepared.hasTelemetry, prepared.normalizedCurrent.length]);

  if (!prepared.hasTelemetry) {
    return (
      <section className="panel track-map">
        <div className="track-map-head">
          <h3>Track quality fallback</h3>
          <p>No reliable XY trace. Showing sector intensity instead.</p>
        </div>
        <div className="sector-fallback">
          {prepared.fallbackSectors.map((value, index) => (
            <div key={`sector-${index}`} className="sector-row">
              <span>Sector {index + 1}</span>
              <div className="sector-bar-shell">
                <div className="sector-bar" style={{ width: `${Math.max(8, value * 100)}%` }} />
              </div>
              <strong>{value.toFixed(2)}</strong>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const z = prepared.z;
  const minAbs = Math.max(Math.abs(Math.min(...z, 0)), Math.abs(Math.max(...z, 0)));
  const playheadPoint = prepared.normalizedCurrent[playhead] ?? prepared.normalizedCurrent[0];
  const brakingX = prepared.brakingZones.map((item) => prepared.normalizedCurrent[item.index]?.x).filter((v): v is number => Number.isFinite(v));
  const brakingY = prepared.brakingZones.map((item) => prepared.normalizedCurrent[item.index]?.y).filter((v): v is number => Number.isFinite(v));

  return (
    <section className="panel track-map">
      <div className="track-map-head">
        <h3>Track delta overlay</h3>
        <p>Resampled high-density telemetry ({RESAMPLE_POINTS} pts) with feature heat coloring.</p>
      </div>
      <div className={`plot-shell ${fadeIn ? 'ready' : ''}`}>
        <Plot
          data={[
            {
              x: prepared.normalizedOutline.map((point) => point.x),
              y: prepared.normalizedOutline.map((point) => point.y),
              mode: 'lines',
              type: 'scatter',
              line: {
                color: theme === 'dark' ? 'rgba(222,227,236,0.36)' : 'rgba(49,62,80,0.42)',
                width: 2.2,
              },
              name: 'Baseline outline',
              hoverinfo: 'skip',
            },
            {
              x: prepared.normalizedCurrent.map((point) => point.x),
              y: prepared.normalizedCurrent.map((point) => point.y),
              mode: 'markers',
              type: 'scatter',
              marker: {
                size: 4.3,
                opacity: 0.9,
                color: z,
                colorscale: [
                  [0, '#2b5ea6'],
                  [0.5, '#dee6f3'],
                  [1, '#cf4637'],
                ],
                cmin: -minAbs,
                cmax: minAbs,
                colorbar: {
                  title: {
                    text: 'Delta',
                    side: 'right',
                    font: { color: theme === 'dark' ? '#e3ebfa' : '#122035' },
                  },
                  thickness: 10,
                  len: 0.74,
                  outlinewidth: 0,
                  tickfont: {
                    color: theme === 'dark' ? '#e3ebfa' : '#122035',
                  },
                },
              },
              text: z.map((delta) => `Delta: ${delta.toFixed(3)}`),
              hovertemplate: '%{text}<extra></extra>',
              name: 'Feature heat',
            },
            {
              x: brakingX,
              y: brakingY,
              mode: 'markers',
              type: 'scatter',
              marker: {
                size: 7.5,
                color: theme === 'dark' ? 'rgba(255,116,94,0.92)' : 'rgba(221,62,43,0.85)',
                line: {
                  color: theme === 'dark' ? '#1f0906' : '#fff7f5',
                  width: 1,
                },
              },
              name: 'Braking zones',
              hoverinfo: 'skip',
            },
            {
              x: prepared.normalizedBaseline.map((point) => point.x),
              y: prepared.normalizedBaseline.map((point) => point.y),
              mode: 'lines',
              type: 'scatter',
              line: {
                color: theme === 'dark' ? 'rgba(110,148,220,0.4)' : 'rgba(58,95,158,0.38)',
                width: 1.4,
                dash: 'dot',
              },
              hoverinfo: 'skip',
              name: 'Reference lap',
            },
            {
              x: [playheadPoint?.x ?? 0],
              y: [playheadPoint?.y ?? 0],
              mode: 'markers',
              type: 'scatter',
              marker: {
                size: 11,
                color: theme === 'dark' ? '#7bc4ff' : '#2f68ce',
                line: {
                  color: theme === 'dark' ? '#0a1c30' : '#ffffff',
                  width: 2,
                },
              },
              name: 'Live position',
              hoverinfo: 'skip',
            },
          ]}
          layout={{
            autosize: true,
            margin: { l: 6, r: 36, t: 8, b: 8 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            xaxis: {
              visible: false,
              scaleanchor: 'y',
              scaleratio: 1,
            },
            yaxis: {
              visible: false,
            },
            showlegend: true,
            legend: {
              orientation: 'h',
              yanchor: 'bottom',
              y: 1.01,
              xanchor: 'right',
              x: 1,
              font: {
                size: 10,
                color: theme === 'dark' ? '#ccdaf6' : '#1a2a43',
              },
              bgcolor: 'rgba(0,0,0,0)',
            },
            font: {
              color: theme === 'dark' ? '#dce6ff' : '#12203a',
            },
            hovermode: 'closest',
            transition: {
              duration: 240,
              easing: 'cubic-in-out',
            },
          }}
          config={{
            displayModeBar: false,
            responsive: true,
          }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
        />
      </div>
    </section>
  );
}
