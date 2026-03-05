import type { Compound, FeatureKey, Track, TrackCondition } from '../data/api';

interface ControlsBarProps {
  tracks: Track[];
  drivers: string[];
  laps: number[];
  track: string;
  driver: string;
  compound: Compound;
  conditions: TrackCondition;
  feature: FeatureKey;
  lap: number;
  theme: 'light' | 'dark';
  onTrackChange: (track: string) => void;
  onDriverChange: (driver: string) => void;
  onCompoundChange: (compound: Compound) => void;
  onConditionsChange: (conditions: TrackCondition) => void;
  onFeatureChange: (feature: FeatureKey) => void;
  onLapChange: (lap: number) => void;
  onThemeToggle: () => void;
}

const compounds: Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];
const conditions: TrackCondition[] = ['dry', 'hot', 'cool', 'damp', 'wet'];

const featureLabels: Record<FeatureKey, string> = {
  braking_earlier_delta: 'Braking earlier delta',
  lower_corner_speed_delta: 'Lower corner speed delta',
  throttle_delay_delta: 'Throttle delay delta',
  degradation_intensity_proxy: 'Degradation intensity proxy',
};

export default function ControlsBar({
  tracks,
  drivers,
  laps,
  track,
  driver,
  compound,
  conditions: condition,
  feature,
  lap,
  theme,
  onTrackChange,
  onDriverChange,
  onCompoundChange,
  onConditionsChange,
  onFeatureChange,
  onLapChange,
  onThemeToggle,
}: ControlsBarProps) {
  const minLap = laps[0] ?? 1;
  const maxLap = laps[laps.length - 1] ?? 1;

  return (
    <section className="panel controls-bar">
      <div className="controls-grid">
        <label>
          Track
          <select value={track} onChange={(event) => onTrackChange(event.target.value)}>
            {tracks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Driver
          <select value={driver} onChange={(event) => onDriverChange(event.target.value)}>
            {drivers.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label>
          Tyre Compound
          <select value={compound} onChange={(event) => onCompoundChange(event.target.value as Compound)}>
            {compounds.map((item) => (
              <option key={item} value={item}>
                {item.toUpperCase()}
              </option>
            ))}
          </select>
        </label>

        <label>
          Track Conditions
          <select
            value={condition}
            onChange={(event) => onConditionsChange(event.target.value as TrackCondition)}
          >
            {conditions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label>
          Heatmap Feature
          <select value={feature} onChange={(event) => onFeatureChange(event.target.value as FeatureKey)}>
            {Object.entries(featureLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="theme-toggle" onClick={onThemeToggle}>
          {theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        </button>
      </div>

      <div className="lap-slider-wrap">
        <div className="lap-slider-labels">
          <span>Lap</span>
          <strong>{lap}</strong>
        </div>
        <input
          type="range"
          min={minLap}
          max={maxLap}
          step={1}
          value={lap}
          onChange={(event) => onLapChange(Number(event.target.value))}
          disabled={laps.length === 0}
        />
      </div>
    </section>
  );
}
