import { useMemo } from 'react';
import Plotly from 'plotly.js-basic-dist';
import createPlotlyComponent from 'react-plotly.js/factory';
import type { TelemetryPoint, XYPoint, Prediction } from '../data/api';

const Plot = createPlotlyComponent(Plotly);
const RESAMPLE_POINTS = 800;

/* ── Props ──────────────────────────────────────────────────── */
interface TrackMapProps {
  outline: XYPoint[];
  telemetry: TelemetryPoint[];
  baselineTelemetry: TelemetryPoint[];
  lap: number;
  totalLaps: number;
  prediction: Prediction | null;
}

/* ── Geometry helpers ───────────────────────────────────────── */
interface Transform { cx: number; cy: number; scale: number }

function hasValidXY(pts: XYPoint[]): boolean {
  if (pts.length < 12) return false;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return (Math.max(...xs) - Math.min(...xs)) > 1e-3 && (Math.max(...ys) - Math.min(...ys)) > 1e-3;
}

function cumDist(pts: XYPoint[]): number[] {
  const d = new Array<number>(pts.length).fill(0);
  for (let i = 1; i < pts.length; i++) d[i] = d[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return d;
}

function resampleTel(pts: TelemetryPoint[], n: number): TelemetryPoint[] {
  if (pts.length < 3 || n <= pts.length) return pts;
  const dist = cumDist(pts), total = dist[dist.length - 1];
  if (!Number.isFinite(total) || total < 1e-6) return pts;
  const out: TelemetryPoint[] = [];
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const t = (total * i) / (n - 1);
    while (idx < dist.length - 2 && dist[idx + 1] < t) idx++;
    const l = pts[idx], r = pts[idx + 1];
    const span = Math.max(dist[idx + 1] - dist[idx], 1e-9);
    const ratio = (t - dist[idx]) / span;
    out.push({
      x: l.x + (r.x - l.x) * ratio, y: l.y + (r.y - l.y) * ratio,
      speed: l.speed + (r.speed - l.speed) * ratio,
      brake: l.brake + (r.brake - l.brake) * ratio,
      throttle: l.throttle + (r.throttle - l.throttle) * ratio,
    });
  }
  return out;
}

function resampleXY(pts: XYPoint[], n: number): XYPoint[] {
  if (pts.length < 3 || n <= pts.length) return pts;
  const dist = cumDist(pts), total = dist[dist.length - 1];
  if (!Number.isFinite(total) || total < 1e-6) return pts;
  const out: XYPoint[] = [];
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const t = (total * i) / (n - 1);
    while (idx < dist.length - 2 && dist[idx + 1] < t) idx++;
    const l = pts[idx], r = pts[idx + 1];
    const span = Math.max(dist[idx + 1] - dist[idx], 1e-9);
    const ratio = (t - dist[idx]) / span;
    out.push({ x: l.x + (r.x - l.x) * ratio, y: l.y + (r.y - l.y) * ratio });
  }
  return out;
}

function smooth(pts: TelemetryPoint[], w = 7): TelemetryPoint[] {
  if (pts.length < 5) return pts;
  const h = Math.floor(w / 2);
  return pts.map((_, i) => {
    let x = 0, y = 0, sp = 0, br = 0, th = 0, c = 0;
    for (let j = -h; j <= h; j++) {
      const p = pts[(i + j + pts.length) % pts.length];
      x += p.x; y += p.y; sp += p.speed; br += p.brake; th += p.throttle; c++;
    }
    return { x: x / c, y: y / c, speed: sp / c, brake: br / c, throttle: th / c };
  });
}

function smoothXY(pts: XYPoint[], w = 7): XYPoint[] {
  if (pts.length < 5) return pts;
  const h = Math.floor(w / 2);
  return pts.map((_, i) => {
    let x = 0, y = 0, c = 0;
    for (let j = -h; j <= h; j++) {
      const p = pts[(i + j + pts.length) % pts.length];
      x += p.x; y += p.y; c++;
    }
    return { x: x / c, y: y / c };
  });
}

function getTransform(pts: XYPoint[]): Transform {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale: Math.max(maxX - minX, maxY - minY) / 2 || 1 };
}

function norm(p: XYPoint, t: Transform): XYPoint {
  return { x: ((p.x - t.cx) / t.scale) * 100, y: ((p.y - t.cy) / t.scale) * 100 };
}

/* ── Stint-aware wear fraction ──────────────────────────────── */
function stintWear(lap: number, pitLap: number, totalLaps: number): number {
  if (lap <= pitLap) {
    // Stint 1: wear builds from 0 to ~1 over the first stint
    return Math.min(1, lap / Math.max(pitLap, 1));
  }
  // Stint 2: fresh tyres after pit, wear builds again
  const stintLap = lap - pitLap;
  const stint2Len = totalLaps - pitLap;
  return Math.min(1, stintLap / Math.max(stint2Len, 1));
}

/* ── Zone extraction ────────────────────────────────────────── */
interface ZoneSeg { startIdx: number; endIdx: number; type: 'brake' | 'throttle' }

function extractZones(samples: TelemetryPoint[], type: 'brake' | 'throttle', threshold: number): ZoneSeg[] {
  const zones: ZoneSeg[] = [];
  let inZone = false, start = 0, count = 0;
  for (let i = 0; i < samples.length; i++) {
    const val = type === 'brake' ? samples[i].brake : samples[i].throttle;
    if (val >= threshold) {
      if (!inZone) { inZone = true; start = i; count = 0; }
      count++;
    } else if (inZone) {
      if (count >= 5) zones.push({ startIdx: start, endIdx: i - 1, type });
      inZone = false;
    }
  }
  if (inZone && count >= 5) zones.push({ startIdx: start, endIdx: samples.length - 1, type });
  return zones;
}

/* ── Component ──────────────────────────────────────────────── */
export default function TrackMap({
  outline, telemetry, baselineTelemetry: _baselineTelemetry, lap, totalLaps, prediction,
}: TrackMapProps) {

  const pitLap = prediction?.strategy_optimal_pit_lap ?? Math.floor(totalLaps / 2);
  const wear = stintWear(lap, pitLap, totalLaps);
  const wearPct = Math.round(wear * 100);
  const inStint2 = lap > pitLap;
  const stintLap = inStint2 ? lap - pitLap : lap;

  // ── STABLE GEOMETRY: computed from outline only, never changes per lap ──
  const geometry = useMemo(() => {
    const outSmooth = smoothXY(resampleXY(outline, RESAMPLE_POINTS));
    const hasOut = hasValidXY(outSmooth);
    if (!hasOut) return null;
    const tf = getTransform(outSmooth);
    const normOut = outSmooth.map((p) => norm(p, tf));

    // Tight axis bounds — locked once from outline
    const xs = normOut.map((p) => p.x);
    const ys = normOut.map((p) => p.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const pad = Math.max(xMax - xMin, yMax - yMin) * 0.08;

    return {
      normOut,
      tf,
      xRange: [xMin - pad, xMax + pad] as [number, number],
      yRange: [yMin - pad, yMax + pad] as [number, number],
    };
  }, [outline]); // ONLY outline — stable across laps

  // ── LAP-VARYING TELEMETRY: braking/throttle data changes per lap ──
  const telData = useMemo(() => {
    if (!geometry) return null;
    const tel = smooth(resampleTel(telemetry, RESAMPLE_POINTS));
    const hasTel = hasValidXY(tel);
    if (!hasTel) return null;

    // Normalize telemetry positions using the SAME stable transform
    const normTel = tel.map((p) => norm(p, geometry.tf));
    const brakeZones = extractZones(tel, 'brake', 0.5);
    const throttleZones = extractZones(tel, 'throttle', 0.8);

    return { normTel, tel, brakeZones, throttleZones };
  }, [telemetry, geometry]);

  /* ── Fallback ─────────────────────────────────────────────── */
  if (!geometry || !telData) {
    return (
      <div style={{ padding: '16px' }}>
        <div style={{
          fontFamily: 'var(--font-label)', fontSize: '0.7rem',
          letterSpacing: '0.14em', textTransform: 'uppercase',
          color: 'var(--text-muted)', marginBottom: '16px',
        }}>
          No telemetry trace available
        </div>
      </div>
    );
  }

  const { normOut, xRange, yRange } = geometry;
  const { normTel, tel, brakeZones, throttleZones } = telData;

  // Line widths scale with stint wear (fresh = thin, worn = thick)
  const brakeWidth = 3 + wear * 10; // 3→13px
  const throttleWidth = 2 + (1 - wear) * 5; // 7→2px

  const traces: Plotly.Data[] = [];

  // 1. Track outline — thin neutral line
  traces.push({
    x: normOut.map((p) => p.x),
    y: normOut.map((p) => p.y),
    mode: 'lines', type: 'scatter',
    line: { color: 'rgba(255,255,255,0.15)', width: 2.5 },
    name: 'Track', hoverinfo: 'skip',
  });

  // 2. Color the entire track by brake/throttle state as a thin baseline
  // This gives context — green for throttle sections, dim for coasting
  const trackColors = tel.map((p) => {
    if (p.brake > 0.5) return 'rgba(255,80,60,0.12)';
    if (p.throttle > 0.8) return 'rgba(54,232,136,0.08)';
    return 'rgba(255,255,255,0.04)';
  });
  traces.push({
    x: normTel.map((p) => p.x),
    y: normTel.map((p) => p.y),
    mode: 'markers', type: 'scatter',
    marker: { size: 3, color: trackColors, opacity: 1 },
    name: 'Telemetry base', showlegend: false, hoverinfo: 'skip',
  });

  // 3. Braking zones — RED lines at exact telemetry braking locations
  brakeZones.forEach((zone, zi) => {
    const xs: number[] = [], ys: number[] = [], texts: string[] = [];
    for (let i = zone.startIdx; i <= zone.endIdx; i++) {
      if (normTel[i] && tel[i]) {
        xs.push(normTel[i].x); ys.push(normTel[i].y);
        texts.push(
          `<b>Braking Zone ${zi + 1}</b><br>` +
          `Brake: ${(tel[i].brake * 100).toFixed(0)}%<br>` +
          `Speed: ${tel[i].speed.toFixed(0)} km/h<br>` +
          `Stint ${inStint2 ? 2 : 1}, lap ${stintLap}<br>` +
          `Tyre age: ${wearPct}%`
        );
      }
    }
    // Opacity and color intensity increase with wear
    const r = Math.min(255, 200 + Math.round(wear * 55));
    const g = Math.max(30, Math.round(80 - wear * 50));
    const alpha = 0.6 + wear * 0.35;
    traces.push({
      x: xs, y: ys, mode: 'lines', type: 'scatter',
      line: { color: `rgba(${r},${g},40,${alpha})`, width: brakeWidth },
      name: zi === 0 ? `Braking (stint ${inStint2 ? 2 : 1})` : undefined,
      showlegend: zi === 0,
      text: texts, hovertemplate: '%{text}<extra></extra>',
    });
  });

  // 4. Throttle/acceleration zones — GREEN lines
  throttleZones.forEach((zone, zi) => {
    const xs: number[] = [], ys: number[] = [], texts: string[] = [];
    for (let i = zone.startIdx; i <= zone.endIdx; i++) {
      if (normTel[i] && tel[i]) {
        xs.push(normTel[i].x); ys.push(normTel[i].y);
        texts.push(
          `<b>Acceleration Zone ${zi + 1}</b><br>` +
          `Throttle: ${(tel[i].throttle * 100).toFixed(0)}%<br>` +
          `Speed: ${tel[i].speed.toFixed(0)} km/h<br>` +
          `Stint ${inStint2 ? 2 : 1}, lap ${stintLap}<br>` +
          `Tyre age: ${wearPct}%`
        );
      }
    }
    const alpha = 0.4 + (1 - wear) * 0.4;
    traces.push({
      x: xs, y: ys, mode: 'lines', type: 'scatter',
      line: { color: `rgba(54,232,136,${alpha})`, width: throttleWidth },
      name: zi === 0 ? `Throttle (stint ${inStint2 ? 2 : 1})` : undefined,
      showlegend: zi === 0,
      text: texts, hovertemplate: '%{text}<extra></extra>',
    });
  });

  // 5. Brake point entry markers (triangles where braking starts)
  const brakeEntries = brakeZones.map((z) => normTel[z.startIdx]).filter(Boolean);
  if (brakeEntries.length > 0) {
    traces.push({
      x: brakeEntries.map((p) => p.x),
      y: brakeEntries.map((p) => p.y),
      mode: 'markers', type: 'scatter',
      marker: {
        size: 5 + wear * 4,
        color: `rgba(255,100,80,${0.7 + wear * 0.3})`,
        symbol: 'triangle-down',
        line: { color: 'rgba(255,200,190,0.4)', width: 1 },
      },
      name: 'Brake points',
      hovertemplate: brakeEntries.map((_, i) =>
        `<b>Brake Point ${i + 1}</b><br>Stint ${inStint2 ? 2 : 1}, lap ${stintLap}<br>Tyre age: ${wearPct}%<extra></extra>`
      ),
    } as Plotly.Data);
  }

  return (
    <div className="plot-shell ready">
      <Plot
        data={traces}
        layout={{
          autosize: true,
          margin: { l: 6, r: 6, t: 8, b: 8 },
          paper_bgcolor: 'rgba(0,0,0,0)',
          plot_bgcolor: 'rgba(0,0,0,0)',
          xaxis: { visible: false, scaleanchor: 'y', scaleratio: 1, range: xRange, fixedrange: true },
          yaxis: { visible: false, range: yRange, fixedrange: true },
          showlegend: true,
          legend: {
            orientation: 'h', yanchor: 'bottom', y: 1.01, xanchor: 'right', x: 1,
            font: { size: 10, color: 'rgba(255,255,255,0.45)', family: 'Barlow Condensed, sans-serif' },
            bgcolor: 'rgba(0,0,0,0)',
          },
          font: { color: 'rgba(255,255,255,0.5)', family: 'Barlow Condensed, sans-serif' },
          hovermode: 'closest',
          transition: { duration: 0, easing: 'linear' },
          uirevision: 'brake-map-static',
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
  );
}
