import type { Prediction } from '../data/api';

interface KpiPanelProps {
  prediction: Prediction | null;
}

export default function KpiPanel({ prediction }: KpiPanelProps) {
  if (!prediction) {
    return (
      <section className="kpi-panel">
        <article className="kpi-card">Waiting for prediction data...</article>
      </section>
    );
  }

  return (
    <section className="kpi-panel">
      <article className="kpi-card">
        <h3>Predicted lap time increase</h3>
        <p>{prediction.sec_per_lap_increase.toFixed(3)} s/lap</p>
      </article>

      <article className="kpi-card">
        <h3>Optimum pit window</h3>
        <p>
          Lap {prediction.pit_window_start} - {prediction.pit_window_end}
        </p>
      </article>

      <article className="kpi-card">
        <h3>Predicted tyre life remaining</h3>
        <p>{prediction.tyre_life_pct.toFixed(1)}%</p>
      </article>
    </section>
  );
}
