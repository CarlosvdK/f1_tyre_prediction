import { useEffect, useMemo, useState } from 'react';
import type { Prediction } from '../data/api';

interface KpiPanelProps {
  prediction: Prediction | null;
}

function useAnimatedValue(value: number, durationMs = 320): number {
  const [animated, setAnimated] = useState(value);

  useEffect(() => {
    const start = performance.now();
    const from = animated;
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimated(from + (value - from) * eased);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return animated;
}

function Sparkline({ values }: { values: number[] }) {
  const points = useMemo(() => {
    if (values.length === 0) return '';
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = Math.max(hi - lo, 0.0001);
    return values
      .map((value, index) => {
        const x = (index / Math.max(values.length - 1, 1)) * 100;
        const y = 100 - ((value - lo) / span) * 100;
        return `${x},${y}`;
      })
      .join(' ');
  }, [values]);

  return (
    <svg className="kpi-sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} />
    </svg>
  );
}

export default function KpiPanel({ prediction }: KpiPanelProps) {
  const pace = useAnimatedValue(prediction?.sec_per_lap_increase ?? 0);
  const life = useAnimatedValue(prediction?.tyre_life_pct ?? 0);
  const pitMid = useAnimatedValue(
    prediction ? (prediction.pit_window_start + prediction.pit_window_end) / 2 : 0,
  );

  if (!prediction) {
    return (
      <div className="kpi-strip">
        <div className="kpi-loading">
          <span className="kpi-loading-text">Awaiting telemetry data…</span>
        </div>
      </div>
    );
  }

  const paceSpark = [pace * 0.82, pace * 0.88, pace * 0.92, pace, pace * 1.04];
  const lifeSpark = [life + 12, life + 5, life + 1, life - 4, life];
  const pitSpark = [pitMid - 4, pitMid - 2, pitMid, pitMid + 1, pitMid + 3];

  return (
    <div className="kpi-strip">
      <div className="kpi-card">
        <div className="kpi-label">Pace Loss / Lap</div>
        <div className="kpi-value">
          {pace.toFixed(3)}
          <span className="kpi-unit">s/lap</span>
        </div>
        <Sparkline values={paceSpark} />
      </div>

      <div className="kpi-card">
        <div className="kpi-label">Optimum Pit Window</div>
        <div className="kpi-value">
          L{Math.round(prediction.pit_window_start)}–L{Math.round(prediction.pit_window_end)}
        </div>
        <Sparkline values={pitSpark} />
      </div>

      <div className="kpi-card">
        <div className="kpi-label">Tyre Life Remaining</div>
        <div className="kpi-value">
          {life.toFixed(1)}
          <span className="kpi-unit">%</span>
        </div>
        <Sparkline values={lifeSpark} />
      </div>
    </div>
  );
}
