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
  onTrackChange: (track: string) => void;
  onDriverChange: (driver: string) => void;
  onCompoundChange: (compound: Compound) => void;
  onConditionsChange: (conditions: TrackCondition) => void;
  onFeatureChange: (feature: FeatureKey) => void;
  onLapChange: (lap: number) => void;
  onPlayToggle: () => void;
}

const compounds: Compound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];
const conditionsList: TrackCondition[] = ['dry', 'hot', 'cool', 'damp', 'wet'];

const featureLabels: Record<FeatureKey, string> = {
  braking_earlier_delta: 'Braking Earlier',
  lower_corner_speed_delta: 'Corner Speed Delta',
  throttle_delay_delta: 'Throttle Delay',
  degradation_intensity_proxy: 'Degradation Proxy',
};

const compoundColors: Record<Compound, string> = {
  soft: '#e10600',
  medium: '#f5a623',
  hard: '#f0f0f0',
  inter: '#27ae60',
  wet: '#2980b9',
};

export default function ControlsBar({
  tracks,
  drivers,
  laps,
  track,
  driver,
  compound,
  conditions,
  feature,
  lap,
  isPlaying,
  onTrackChange,
  onDriverChange,
  onCompoundChange,
  onConditionsChange,
  onFeatureChange,
  onLapChange,
  onPlayToggle,
}: ControlsBarProps) {
  const minLap = laps[0] ?? 1;
  const maxLap = laps[laps.length - 1] ?? 1;

  return (
    <div className="controls-subbar">
      <div className="controls-row">
        {/* Track */}
        <div className="ctrl-group">
          <span className="ctrl-label">Circuit</span>
          <select
            className="ctrl-select"
            value={track}
            onChange={(e) => onTrackChange(e.target.value)}
          >
            {tracks.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </div>

        {/* Driver */}
        <div className="ctrl-group">
          <span className="ctrl-label">Driver</span>
          <select
            className="ctrl-select"
            value={driver}
            onChange={(e) => onDriverChange(e.target.value)}
          >
            {drivers.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>

        {/* Compound */}
        <div className="ctrl-group">
          <span className="ctrl-label">Tyre</span>
          <select
            className="ctrl-select"
            value={compound}
            onChange={(e) => onCompoundChange(e.target.value as Compound)}
            style={{ color: compoundColors[compound] }}
          >
            {compounds.map((item) => (
              <option key={item} value={item} style={{ color: compoundColors[item] }}>
                {item.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        {/* Conditions */}
        <div className="ctrl-group">
          <span className="ctrl-label">Conditions</span>
          <select
            className="ctrl-select"
            value={conditions}
            onChange={(e) => onConditionsChange(e.target.value as TrackCondition)}
          >
            {conditionsList.map((item) => (
              <option key={item} value={item}>{item.toUpperCase()}</option>
            ))}
          </select>
        </div>

        {/* Feature */}
        <div className="ctrl-group">
          <span className="ctrl-label">Heatmap</span>
          <select
            className="ctrl-select"
            value={feature}
            onChange={(e) => onFeatureChange(e.target.value as FeatureKey)}
          >
            {Object.entries(featureLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        <div className="ctrl-divider" />

        {/* Lap timeline */}
        <div className="lap-group">
          <div className="lap-header">
            <span className="ctrl-label">Lap Timeline</span>
            <span className="lap-value">
              Lap {lap} / {maxLap}
            </span>
          </div>
          <div className="lap-slider-row">
            <button
              type="button"
              className="play-btn"
              onClick={onPlayToggle}
              disabled={laps.length < 2}
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
            <input
              type="range"
              min={minLap}
              max={maxLap}
              step={1}
              value={lap}
              onChange={(e) => onLapChange(Number(e.target.value))}
              disabled={laps.length === 0}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
