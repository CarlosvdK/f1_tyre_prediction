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
    return Math.min(1, lap / Math.max(pitLap, 1));
  }
  const stintLap = lap - pitLap;
  const stint2Len = totalLaps - pitLap;
  return Math.min(1, stintLap / Math.max(stint2Len, 1));
}

/* ── Corner detection from telemetry ───────────────────────── */
interface Corner {
  apexIdx: number;       // index of speed minimum (the corner apex)
  brakeStartIdx: number; // where braking begins approaching this corner
  brakeEndIdx: number;   // apex (end of braking zone)
  accelStartIdx: number; // apex (start of acceleration zone)
  accelEndIdx: number;   // where full throttle is reached after corner
  brakingDist: number;   // meters of braking zone
  accelDist: number;     // meters of acceleration zone
}

function detectCorners(samples: TelemetryPoint[], dist: number[]): Corner[] {
  const n = samples.length;
  if (n < 20) return [];

  // Step 1: Find local speed minima (corner apexes)
  // Use a window to avoid noise
  const windowSize = Math.max(8, Math.round(n * 0.012));
  const apexes: number[] = [];

  for (let i = windowSize; i < n - windowSize; i++) {
    let isMin = true;
    const sp = samples[i].speed;
    for (let j = -windowSize; j <= windowSize; j++) {
      if (j === 0) continue;
      if (samples[i + j].speed < sp - 2) { isMin = false; break; }
    }
    // Must also have braking before it (within a reasonable distance)
    if (isMin && sp < 280) {
      // Check there's actual braking in the approach
      let hasBrake = false;
      for (let b = Math.max(0, i - Math.round(n * 0.08)); b < i; b++) {
        if (samples[b].brake > 0.3) { hasBrake = true; break; }
      }
      if (hasBrake) apexes.push(i);
    }
  }

  // Merge apexes that are too close (keep the one with lowest speed)
  const minSep = Math.round(n * 0.04);
  const merged: number[] = [];
  for (const a of apexes) {
    if (merged.length > 0 && a - merged[merged.length - 1] < minSep) {
      const prev = merged[merged.length - 1];
      if (samples[a].speed < samples[prev].speed) merged[merged.length - 1] = a;
    } else {
      merged.push(a);
    }
  }

  // Step 2: For each apex, find brake start and throttle recovery
  const corners: Corner[] = [];
  const BRAKE_THRESHOLD = 0.25;
  const THROTTLE_THRESHOLD = 0.75;

  for (const apex of merged) {
    // Find where braking starts before the apex
    let brakeStart = apex;
    for (let i = apex - 1; i >= Math.max(0, apex - Math.round(n * 0.12)); i--) {
      if (samples[i].brake >= BRAKE_THRESHOLD) {
        brakeStart = i;
      } else if (brakeStart !== apex) {
        break; // Found end of braking zone going backwards
      }
    }

    // Find where full throttle is reached after apex
    let accelEnd = apex;
    for (let i = apex + 1; i < Math.min(n, apex + Math.round(n * 0.12)); i++) {
      if (samples[i].throttle >= THROTTLE_THRESHOLD) {
        accelEnd = i;
        break;
      }
    }

    // Only keep corners with meaningful braking
    if (brakeStart === apex) continue;

    const brakingDist = dist[apex] - dist[brakeStart];
    const accelDist = dist[accelEnd] - dist[apex];

    if (brakingDist < 5) continue; // too short to be a real corner

    corners.push({
      apexIdx: apex,
      brakeStartIdx: brakeStart,
      brakeEndIdx: apex,
      accelStartIdx: apex,
      accelEndIdx: accelEnd,
      brakingDist,
      accelDist: Math.max(accelDist, 0),
    });
  }

  return corners;
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

  // ── STABLE TELEMETRY POSITIONS: normalized once ──
  const telBase = useMemo(() => {
    if (!geometry) return null;
    const tel = smooth(resampleTel(telemetry, RESAMPLE_POINTS));
    const hasTel = hasValidXY(tel);
    if (!hasTel) return null;
    const normTel = tel.map((p) => norm(p, geometry.tf));
    const dist = cumDist(tel); // cumulative distance in data units
    return { normTel, tel, dist };
  }, [telemetry, geometry]);

  // ── CORNER DETECTION: from base telemetry (stable) ──
  const baseCorners = useMemo(() => {
    if (!telBase) return null;
    return detectCorners(telBase.tel, telBase.dist);
  }, [telBase]);

  // ── WEAR-ADJUSTED CORNERS: recomputed per lap ──
  const wornCorners = useMemo(() => {
    if (!baseCorners || !telBase) return null;
    const { dist, tel } = telBase;
    const n = tel.length;
    const totalDist = dist[n - 1];

    return baseCorners.map((corner, ci) => {
      // Braking distance grows with wear: up to 25% longer at full wear
      const wornBrakeDist = corner.brakingDist * (1 + wear * 0.25);
      // How many more indices does that mean? Scale brakeStart backwards
      const extraBrake = wornBrakeDist - corner.brakingDist;
      // Convert distance to index shift
      const avgSegLen = totalDist / Math.max(n - 1, 1);
      const extraBrakeIdx = Math.round(extraBrake / Math.max(avgSegLen, 0.01));
      const wornBrakeStart = Math.max(0, corner.brakeStartIdx - extraBrakeIdx);

      // Acceleration delay grows with wear: up to 20% slower
      const wornAccelDist = corner.accelDist * (1 + wear * 0.20);
      const extraAccel = wornAccelDist - corner.accelDist;
      const extraAccelIdx = Math.round(extraAccel / Math.max(avgSegLen, 0.01));
      const wornAccelEnd = Math.min(n - 1, corner.accelEndIdx + extraAccelIdx);

      return {
        ...corner,
        wornBrakeStart,
        wornBrakeEnd: corner.brakeEndIdx,
        wornAccelStart: corner.accelStartIdx,
        wornAccelEnd,
        wornBrakeDist: wornBrakeDist,
        wornAccelDist: wornAccelDist,
        cornerNum: ci + 1,
      };
    });
  }, [baseCorners, telBase, wear]);

  /* ── Fallback ─────────────────────────────────────────────── */
  if (!geometry || !telBase || !wornCorners) {
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
  const { normTel, tel } = telBase;

  const traces: Plotly.Data[] = [];

  // 1. Track outline — thin neutral line
  traces.push({
    x: normOut.map((p) => p.x),
    y: normOut.map((p) => p.y),
    mode: 'lines', type: 'scatter',
    line: { color: 'rgba(255,255,255,0.18)', width: 2.5 },
    name: 'Track', hoverinfo: 'skip',
  });

  // 2. Fresh-tyre braking reference — faint red at BASE brake positions
  wornCorners.forEach((c) => {
    const xs: number[] = [], ys: number[] = [];
    for (let i = c.brakeStartIdx; i <= c.brakeEndIdx; i++) {
      if (normTel[i]) { xs.push(normTel[i].x); ys.push(normTel[i].y); }
    }
    if (xs.length > 1) {
      traces.push({
        x: xs, y: ys, mode: 'lines', type: 'scatter',
        line: { color: 'rgba(255,100,80,0.12)', width: 4 },
        showlegend: false, hoverinfo: 'skip',
      });
    }
  });

  // 3. Worn braking zones — RED lines (longer with wear)
  wornCorners.forEach((c, ci) => {
    const xs: number[] = [], ys: number[] = [], texts: string[] = [];
    for (let i = c.wornBrakeStart; i <= c.wornBrakeEnd; i++) {
      if (normTel[i] && tel[i]) {
        xs.push(normTel[i].x); ys.push(normTel[i].y);
        texts.push(
          `<b>T${c.cornerNum} — Braking Zone</b><br>` +
          `Distance: <b>${Math.round(c.wornBrakeDist)}m</b> (fresh: ${Math.round(c.brakingDist)}m)<br>` +
          `+${Math.round(c.wornBrakeDist - c.brakingDist)}m from tyre wear<br>` +
          `Speed: ${tel[i].speed.toFixed(0)} km/h<br>` +
          `Stint ${inStint2 ? 2 : 1}, lap ${stintLap} · Wear ${wearPct}%`
        );
      }
    }
    if (xs.length > 1) {
      // Width scales: 3px fresh → 8px fully worn
      const w = 3 + wear * 5;
      const alpha = 0.65 + wear * 0.3;
      traces.push({
        x: xs, y: ys, mode: 'lines', type: 'scatter',
        line: { color: `rgba(255,80,60,${alpha})`, width: w },
        name: ci === 0 ? 'Braking' : undefined,
        showlegend: ci === 0,
        text: texts, hovertemplate: '%{text}<extra></extra>',
      });
    }
  });

  // 4. Acceleration zones — GREEN lines (longer delay with wear)
  wornCorners.forEach((c, ci) => {
    const xs: number[] = [], ys: number[] = [], texts: string[] = [];
    for (let i = c.wornAccelStart; i <= c.wornAccelEnd; i++) {
      if (normTel[i] && tel[i]) {
        xs.push(normTel[i].x); ys.push(normTel[i].y);
        texts.push(
          `<b>T${c.cornerNum} — Acceleration Zone</b><br>` +
          `Delay: <b>${Math.round(c.wornAccelDist)}m</b> (fresh: ${Math.round(c.accelDist)}m)<br>` +
          `+${Math.round(c.wornAccelDist - c.accelDist)}m from tyre wear<br>` +
          `Speed: ${tel[i].speed.toFixed(0)} km/h<br>` +
          `Stint ${inStint2 ? 2 : 1}, lap ${stintLap} · Wear ${wearPct}%`
        );
      }
    }
    if (xs.length > 1) {
      const w = 2.5 + wear * 4;
      const alpha = 0.55 + wear * 0.3;
      traces.push({
        x: xs, y: ys, mode: 'lines', type: 'scatter',
        line: { color: `rgba(54,232,136,${alpha})`, width: w },
        name: ci === 0 ? 'Throttle' : undefined,
        showlegend: ci === 0,
        text: texts, hovertemplate: '%{text}<extra></extra>',
      });
    }
  });

  // 5. Corner number labels with braking distance
  const labelX: number[] = [], labelY: number[] = [], labelText: string[] = [], labelHover: string[] = [];
  wornCorners.forEach((c) => {
    const apex = normTel[c.apexIdx];
    if (!apex) return;
    labelX.push(apex.x);
    labelY.push(apex.y);
    labelText.push(`T${c.cornerNum}`);
    labelHover.push(
      `<b>Turn ${c.cornerNum}</b><br>` +
      `Braking: ${Math.round(c.wornBrakeDist)}m (${wear > 0.01 ? `+${Math.round(c.wornBrakeDist - c.brakingDist)}m` : 'fresh'})<br>` +
      `Accel delay: ${Math.round(c.wornAccelDist)}m (${wear > 0.01 ? `+${Math.round(c.wornAccelDist - c.accelDist)}m` : 'fresh'})<br>` +
      `Apex speed: ${tel[c.apexIdx].speed.toFixed(0)} km/h`
    );
  });
  if (labelX.length > 0) {
    traces.push({
      x: labelX, y: labelY, mode: 'text+markers', type: 'scatter',
      marker: { size: 4, color: 'rgba(255,255,255,0.5)', symbol: 'circle' },
      text: labelText,
      textposition: 'top center',
      textfont: { size: 12, color: 'rgba(255,255,255,0.6)', family: 'Barlow Condensed, sans-serif' },
      showlegend: false,
      hovertemplate: labelHover.map((h) => `${h}<extra></extra>`),
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
            font: { size: 13, color: 'rgba(255,255,255,0.55)', family: 'Barlow Condensed, sans-serif' },
            bgcolor: 'rgba(0,0,0,0)',
          },
          font: { color: 'rgba(255,255,255,0.5)', family: 'Barlow Condensed, sans-serif', size: 13 },
          hovermode: 'closest',
          transition: { duration: 0, easing: 'linear' },
          uirevision: 'brake-map-static',
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
  );
}
