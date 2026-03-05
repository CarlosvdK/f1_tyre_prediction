import type { ReactNode } from 'react';
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
  isPlaying: boolean;
  theme: 'light' | 'dark';
  onTrackChange: (track: string) => void;
  onDriverChange: (driver: string) => void;
  onCompoundChange: (compound: Compound) => void;
  onConditionsChange: (conditions: TrackCondition) => void;
  onFeatureChange: (feature: FeatureKey) => void;
  onLapChange: (lap: number) => void;
  onPlayToggle: () => void;
  onThemeToggle: () => void;
  onSettingsToggle: () => void;
}

const compounds: Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];
const conditions: TrackCondition[] = ['dry', 'hot', 'cool', 'damp', 'wet'];

const featureLabels: Record<FeatureKey, string> = {
  braking_earlier_delta: 'Braking earlier delta',
  lower_corner_speed_delta: 'Lower corner speed delta',
  throttle_delay_delta: 'Throttle delay delta',
  degradation_intensity_proxy: 'Degradation intensity proxy',
};

function RailControl({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="rail-control">
      <span className="rail-label">
        <span className="rail-icon">{icon}</span>
        {label}
      </span>
      {children}
    </label>
  );
}

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
  isPlaying,
  theme,
  onTrackChange,
  onDriverChange,
  onCompoundChange,
  onConditionsChange,
  onFeatureChange,
  onLapChange,
  onPlayToggle,
  onThemeToggle,
  onSettingsToggle,
}: ControlsBarProps) {
  const minLap = laps[0] ?? 1;
  const maxLap = laps[laps.length - 1] ?? 1;

  return (
    <section className="panel control-rail">
      <div className="controls-grid">
        <RailControl icon="TR" label="Track">
          <select value={track} onChange={(event) => onTrackChange(event.target.value)}>
            {tracks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </RailControl>

        <RailControl icon="DR" label="Driver">
          <select value={driver} onChange={(event) => onDriverChange(event.target.value)}>
            {drivers.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </RailControl>

        <RailControl icon="TC" label="Tyre">
          <select value={compound} onChange={(event) => onCompoundChange(event.target.value as Compound)}>
            {compounds.map((item) => (
              <option key={item} value={item}>
                {item.toUpperCase()}
              </option>
            ))}
          </select>
        </RailControl>

        <RailControl icon="WX" label="Condition">
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
        </RailControl>

        <RailControl icon="HM" label="Heatmap">
          <select value={feature} onChange={(event) => onFeatureChange(event.target.value as FeatureKey)}>
            {Object.entries(featureLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </RailControl>

        <div className="rail-actions">
          <button type="button" className="rail-btn rail-btn-soft" onClick={onSettingsToggle}>
            Settings
          </button>
          <button type="button" className="rail-btn rail-btn-accent" onClick={onThemeToggle}>
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </div>

      <div className="lap-control">
        <div className="lap-head">
          <p>Lap timeline</p>
          <strong>
            Lap {lap} / {maxLap}
          </strong>
        </div>
        <div className="lap-row">
          <button type="button" className="play-btn" onClick={onPlayToggle} disabled={laps.length < 2}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
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
      </div>
    </section>
  );
}
