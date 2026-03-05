import Plotly from 'plotly.js-basic-dist';
import createPlotlyComponent from 'react-plotly.js/factory';
import type { FeatureKey, TelemetryPoint, ThemeMode, XYPoint } from '../data/api';

const Plot = createPlotlyComponent(Plotly);

interface TrackMapProps {
  outline: XYPoint[];
  telemetry: TelemetryPoint[];
  baselineTelemetry: TelemetryPoint[];
  feature: FeatureKey;
  theme: ThemeMode;
}

function averageSpeed(points: TelemetryPoint[]): number {
  if (points.length === 0) {
    return 0;
  }
  const sum = points.reduce((total, item) => total + item.speed, 0);
  return sum / points.length;
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
      return (speedPenalty * 0.7) + current.brake * 0.5 - current.throttle * 0.35;
    }
    default:
      return 0;
  }
}

export default function TrackMap({
  outline,
  telemetry,
  baselineTelemetry,
  feature,
  theme,
}: TrackMapProps) {
  const safeBaseline = baselineTelemetry.length > 0 ? baselineTelemetry : telemetry;
  const avgSpeed = averageSpeed(telemetry);

  const x = telemetry.map((point) => point.x);
  const y = telemetry.map((point) => point.y);
  const z = telemetry.map((point, index) => {
    const baseline = safeBaseline[index % safeBaseline.length] ?? point;
    return computeFeatureDelta(feature, point, baseline, avgSpeed);
  });

  const minZ = Math.min(...z, 0);
  const maxZ = Math.max(...z, 0.001);

  return (
    <section className="panel track-map">
      <h3>2D Track Map + Feature Delta Heat</h3>
      <Plot
        data={[
          {
            x: outline.map((point) => point.x),
            y: outline.map((point) => point.y),
            mode: 'lines',
            type: 'scatter',
            line: {
              color: theme === 'dark' ? '#8b8f98' : '#60666f',
              width: 3,
            },
            name: 'Track outline',
            hoverinfo: 'skip',
          },
          {
            x,
            y,
            mode: 'markers+lines',
            type: 'scatter',
            marker: {
              size: 9,
              color: z,
              colorscale: 'Turbo',
              cmin: minZ,
              cmax: maxZ,
              line: {
                color: theme === 'dark' ? '#0a0b0e' : '#f7f8fc',
                width: 0.5,
              },
              colorbar: {
                title: {
                  text: 'Delta',
                  font: {
                    color: theme === 'dark' ? '#dfe6f3' : '#1f2732',
                  },
                },
                thickness: 12,
                tickfont: {
                  color: theme === 'dark' ? '#dfe6f3' : '#1f2732',
                },
              },
            },
            line: {
              color: theme === 'dark' ? 'rgba(210,220,255,0.3)' : 'rgba(33,58,102,0.28)',
              width: 2,
            },
            name: 'Current lap telemetry',
            text: z.map((delta) => `Delta: ${delta.toFixed(3)}`),
            hovertemplate: '%{text}<extra></extra>',
          },
        ]}
        layout={{
          autosize: true,
          margin: { l: 10, r: 20, t: 16, b: 10 },
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
          showlegend: false,
          font: {
            color: theme === 'dark' ? '#dce6ff' : '#12203a',
          },
          hovermode: 'closest',
        }}
        config={{
          displayModeBar: false,
          responsive: true,
        }}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler
      />
    </section>
  );
}
