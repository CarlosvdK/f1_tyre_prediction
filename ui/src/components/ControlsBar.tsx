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
  lower_corner_speed_delta: 'Corner Speed Δ',
  throttle_delay_delta: 'Throttle Delay',
  degradation_intensity_proxy: 'Degradation',
};

export default function ControlsBar({
  tracks, drivers, laps,
  track, driver, compound, conditions, feature, lap, isPlaying,
  onTrackChange, onDriverChange, onCompoundChange, onConditionsChange,
  onFeatureChange, onLapChange, onPlayToggle,
}: ControlsBarProps) {
  const minLap = laps[0] ?? 1;
  const maxLap = laps[laps.length - 1] ?? 1;

  return (
    <div className="controls-subbar">
      <div className="controls-row">

        {/* Circuit */}
        <div className="ctrl-cell">
          <span className="ctrl-label">Circuit</span>
          <select
            className="ctrl-select"
            value={track}
            onChange={(e) => onTrackChange(e.target.value)}
          >
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Driver */}
        <div className="ctrl-cell">
          <span className="ctrl-label">Driver</span>
          <select
            className="ctrl-select"
            value={driver}
            onChange={(e) => onDriverChange(e.target.value)}
          >
            {drivers.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {/* Tyre compound — text colour matches compound */}
        <div className="ctrl-cell">
          <span className="ctrl-label">Tyre</span>
          <select
            className={`ctrl-select compound-${compound}`}
            value={compound}
            onChange={(e) => onCompoundChange(e.target.value as Compound)}
          >
            {compounds.map((c) => (
              <option key={c} value={c}>{c.toUpperCase()}</option>
            ))}
          </select>
        </div>

        {/* Conditions */}
        <div className="ctrl-cell">
          <span className="ctrl-label">Conditions</span>
          <select
            className="ctrl-select"
            value={conditions}
            onChange={(e) => onConditionsChange(e.target.value as TrackCondition)}
          >
            {conditionsList.map((c) => (
              <option key={c} value={c}>{c.toUpperCase()}</option>
            ))}
          </select>
        </div>

        {/* Heatmap feature */}
        <div className="ctrl-cell">
          <span className="ctrl-label">Heatmap</span>
          <select
            className="ctrl-select"
            value={feature}
            onChange={(e) => onFeatureChange(e.target.value as FeatureKey)}
          >
            {Object.entries(featureLabels).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {/* Lap timeline — fills remaining space */}
        <div className="ctrl-lap">
          <span className="ctrl-lap-label">Lap</span>
          <span className="ctrl-lap-value">{lap} / {maxLap}</span>
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
  );
}
