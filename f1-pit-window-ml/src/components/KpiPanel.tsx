import { useEffect, useMemo, useState } from 'react';
import type { Prediction } from '../data/api';

interface KpiPanelProps {
  prediction: Prediction | null;
}

function useAnimatedValue(value: number, durationMs = 280): number {
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
    if (values.length === 0) {
      return '';
    }
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
      <section className="kpi-panel">
        <article className="kpi-card">
          <h3>Predictions</h3>
          <p>Waiting for telemetry...</p>
        </article>
      </section>
    );
  }

  const paceSpark = [pace * 0.82, pace * 0.88, pace * 0.92, pace, pace * 1.04];
  const lifeSpark = [life + 12, life + 5, life + 1, life - 4, life];
  const pitSpark = [pitMid - 4, pitMid - 2, pitMid, pitMid + 1, pitMid + 3];

  return (
    <section className="kpi-panel">
      <article className="kpi-card">
        <h3>Pace Loss Per Lap</h3>
        <p>
          {pace.toFixed(3)}
          <small>s/lap</small>
        </p>
        <Sparkline values={paceSpark} />
      </article>

      <article className="kpi-card">
        <h3>Optimum Pit Window</h3>
        <p>
          L{Math.round(prediction.pit_window_start)}-L{Math.round(prediction.pit_window_end)}
        </p>
        <Sparkline values={pitSpark} />
      </article>

      <article className="kpi-card">
        <h3>Tyre Life Remaining</h3>
        <p>
          {life.toFixed(1)}
          <small>%</small>
        </p>
        <Sparkline values={lifeSpark} />
      </article>
    </section>
  );
}
