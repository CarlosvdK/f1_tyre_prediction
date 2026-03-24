import { useMemo } from 'react';
import Plotly from 'plotly.js-basic-dist';
import createPlotlyComponent from 'react-plotly.js/factory';
import type { TelemetryPoint, XYPoint } from '../data/api';

const Plot = createPlotlyComponent(Plotly);
const RESAMPLE_POINTS = 800;

/* ── Props ──────────────────────────────────────────────────── */
interface TrackMapProps {
  outline: XYPoint[];
  telemetry: TelemetryPoint[];
  baselineTelemetry: TelemetryPoint[];
  lap: number;
  totalLaps: number;
  pitLaps: number[];
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
    let x = 0, y = 0, sp = 0, c = 0;
    for (let j = -h; j <= h; j++) {
      const p = pts[(i + j + pts.length) % pts.length];
      x += p.x; y += p.y; sp += p.speed; c++;
    }
    // Smooth position and speed, but keep brake/throttle sharp (no bleed)
    return { x: x / c, y: y / c, speed: sp / c, brake: pts[i].brake, throttle: pts[i].throttle };
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

/* ── Stint-aware wear fraction (multi-stop) ───────────────── */
function stintWear(lap: number, totalLaps: number, pitLaps: number[]): number {
  const stops = [0, ...pitLaps, totalLaps];
  for (let i = 0; i < stops.length - 1; i++) {
    if (lap <= stops[i + 1]) {
      const stintStart = stops[i];
      const stintEnd = stops[i + 1];
      const stintLen = Math.max(stintEnd - stintStart, 1);
      return Math.max(0, (lap - stintStart - 1) / stintLen);
    }
  }
  return 0.5;
}

/* ── Classify each telemetry point ────────────────────────── */
type Zone = 'brake' | 'throttle' | 'neutral';
const BRAKE_THRESH = 0.4;
const THROTTLE_THRESH = 0.3;

function classifyPoint(pt: TelemetryPoint): Zone {
  // Brake takes priority — if braking, it's a brake zone
  if (pt.brake > BRAKE_THRESH) return 'brake';
  if (pt.throttle > THROTTLE_THRESH) return 'throttle';
  return 'neutral';
}

/* ── Group consecutive same-zone points into segments ─────── */
interface Segment { zone: Zone; start: number; end: number }

function buildSegments(tel: TelemetryPoint[]): Segment[] {
  if (tel.length === 0) return [];
  const segs: Segment[] = [];
  let cur = classifyPoint(tel[0]);
  let segStart = 0;
  for (let i = 1; i < tel.length; i++) {
    const z = classifyPoint(tel[i]);
    if (z !== cur) {
      segs.push({ zone: cur, start: segStart, end: i - 1 });
      cur = z;
      segStart = i;
    }
  }
  segs.push({ zone: cur, start: segStart, end: tel.length - 1 });
  return segs;
}

/* ── Component ──────────────────────────────────────────────── */
export default function TrackMap({
  outline, telemetry, baselineTelemetry: _baselineTelemetry, lap, totalLaps, pitLaps,
}: TrackMapProps) {

  const wear = stintWear(lap, totalLaps, pitLaps);
  const wearPct = Math.round(wear * 100);

  // Which stint is the current lap in?
  const stops = [0, ...pitLaps, totalLaps];
  let currentStint = 1;
  let stintLap = lap;
  for (let i = 0; i < stops.length - 1; i++) {
    if (lap <= stops[i + 1]) {
      currentStint = i + 1;
      stintLap = lap - stops[i];
      break;
    }
  }

  // ── STABLE GEOMETRY: computed from outline only ──
  const geometry = useMemo(() => {
    const outSmooth = smoothXY(resampleXY(outline, RESAMPLE_POINTS));
    const hasOut = hasValidXY(outSmooth);
    if (!hasOut) return null;
    const tf = getTransform(outSmooth);
    const normOut = outSmooth.map((p) => norm(p, tf));

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
  }, [outline]);

  // ── TELEMETRY: reprocessed per lap (telemetry changes via modulateTelemetry) ──
  const telData = useMemo(() => {
    if (!geometry) return null;
    const tel = smooth(resampleTel(telemetry, RESAMPLE_POINTS));
    const hasTel = hasValidXY(tel);
    if (!hasTel) return null;
    const normTel = tel.map((p) => norm(p, geometry.tf));
    const segments = buildSegments(tel);
    return { normTel, tel, segments };
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
  const { normTel, tel, segments } = telData;

  const traces: Plotly.Data[] = [];

  // 1. Track outline — thin neutral base
  traces.push({
    x: normOut.map((p) => p.x),
    y: normOut.map((p) => p.y),
    mode: 'lines', type: 'scatter',
    line: { color: 'rgba(255,255,255,0.18)', width: 2.5 },
    name: 'Track', hoverinfo: 'skip', showlegend: false,
  });

  // 2. Draw each segment directly from telemetry brake/throttle data
  //    Red = braking (entering corners), Green = throttle (exiting corners / straights)
  //    Width scales with wear: braking gets thicker, throttle gets thinner
  let brakeFirst = true;
  let throttleFirst = true;

  for (const seg of segments) {
    // Overlap 1 point on each side for visual continuity between segments
    const i0 = Math.max(0, seg.start - 1);
    const i1 = Math.min(tel.length - 1, seg.end + 1);

    const xs: number[] = [], ys: number[] = [], texts: string[] = [];
    // Estimate fresh-tyre speed at this section (no wear penalty)
    // modulateTelemetry scales speed by paceDrop = 1 - (wear * ~0.07)
    // So fresh speed ≈ current speed / (1 - wear * 0.07)
    const freshSpeedFactor = 1 / Math.max(1 - wear * 0.07, 0.9);

    for (let i = i0; i <= i1; i++) {
      xs.push(normTel[i].x);
      ys.push(normTel[i].y);
      const pt = tel[i];
      const freshSpeed = pt.speed * freshSpeedFactor;
      const speedDelta = pt.speed - freshSpeed;
      const label = seg.zone === 'brake' ? 'BRAKING' : seg.zone === 'throttle' ? 'THROTTLE' : 'COASTING';

      let hover = `<b style="font-size:18px">${label}</b><br><br>`;
      hover += `<b>Speed:</b> ${pt.speed.toFixed(0)} km/h`;
      if (wearPct > 2) hover += `  <span style="color:${speedDelta < 0 ? '#ff6450' : '#36e888'}">(${speedDelta >= 0 ? '+' : ''}${speedDelta.toFixed(1)} vs fresh)</span>`;
      hover += '<br>';

      if (seg.zone === 'brake') {
        hover += `<b>Brake pressure:</b> ${(pt.brake * 100).toFixed(0)}%<br>`;
        if (wearPct > 2) {
          hover += `<b>vs Fresh tyres:</b> braking ${Math.round(wear * 25)}% earlier<br>`;
        }
      }
      if (seg.zone === 'throttle') {
        hover += `<b>Throttle:</b> ${(pt.throttle * 100).toFixed(0)}%<br>`;
        if (wearPct > 2) {
          hover += `<b>vs Fresh tyres:</b> ${Math.round(wear * 11)}% less traction<br>`;
        }
      }

      hover += `<br><b>Stint ${currentStint}</b> · Lap ${stintLap} · Tyre wear ${wearPct}%`;
      texts.push(hover);
    }

    if (xs.length < 2) continue;

    if (seg.zone === 'brake') {
      // Braking: red, gets thicker with more wear (worn tyres = brake harder/earlier)
      const w = 3 + wear * 5;
      const alpha = 0.65 + wear * 0.3;
      traces.push({
        x: xs, y: ys, mode: 'lines', type: 'scatter',
        line: { color: `rgba(255,80,60,${alpha})`, width: w },
        name: brakeFirst ? 'Braking' : undefined,
        showlegend: brakeFirst,
        text: texts, hovertemplate: '%{text}<extra></extra>',
      });
      brakeFirst = false;
    } else if (seg.zone === 'throttle') {
      // Throttle: green, gets thinner with wear (worn tyres = less traction)
      const w = 2.5 + (1 - wear) * 4;
      const alpha = 0.5 + (1 - wear) * 0.4;
      traces.push({
        x: xs, y: ys, mode: 'lines', type: 'scatter',
        line: { color: `rgba(54,232,136,${alpha})`, width: w },
        name: throttleFirst ? 'Throttle' : undefined,
        showlegend: throttleFirst,
        text: texts, hovertemplate: '%{text}<extra></extra>',
      });
      throttleFirst = false;
    }
    // neutral segments just show the base track outline (already drawn)
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
            font: { size: 20, color: 'rgba(255,255,255,0.55)', family: 'Barlow Condensed, sans-serif' },
            bgcolor: 'rgba(0,0,0,0)',
          },
          font: { color: 'rgba(255,255,255,0.5)', family: 'Barlow Condensed, sans-serif', size: 20 },
          hovermode: 'closest',
          transition: { duration: 0, easing: 'linear' },
          uirevision: 'brake-map-static',
          hoverlabel: {
            bgcolor: 'rgba(14,14,18,0.95)',
            bordercolor: 'rgba(255,255,255,0.2)',
            font: { size: 24, family: 'Barlow Condensed', color: '#f5f5f7' },
          },
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler
      />
    </div>
  );
}
