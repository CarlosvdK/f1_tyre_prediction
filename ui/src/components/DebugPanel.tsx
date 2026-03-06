import type { Compound, FeatureKey, TrackCondition } from '../data/api';

interface DebugPanelProps {
  track: string;
  driver: string;
  lap: number;
  compound: Compound;
  conditions: TrackCondition;
  feature: FeatureKey;
  modelPath?: string;
  modelType?: string;
  tireCount: number;
  wear: {
    FL: number;
    FR: number;
    RL: number;
    RR: number;
  };
}

export default function DebugPanel({
  track,
  driver,
  lap,
  compound,
  conditions,
  feature,
  modelPath,
  modelType,
  tireCount,
  wear,
}: DebugPanelProps) {
  return (
    <section className="debug-panel">
      <div className="debug-grid">
        <span>Track</span>
        <span>{track}</span>
        <span>Driver</span>
        <span>{driver}</span>
        <span>Lap</span>
        <span>{lap}</span>
        <span>Compound</span>
        <span>{compound}</span>
        <span>Conditions</span>
        <span>{conditions}</span>
        <span>Feature</span>
        <span>{feature}</span>
        <span>Model type</span>
        <span>{modelType ?? '-'}</span>
        <span>Model path</span>
        <span className="truncate">{modelPath ?? '-'}</span>
        <span>Detected tire meshes</span>
        <span>{tireCount}</span>
        <span>Wear FL / FR</span>
        <span>
          {(wear.FL * 100).toFixed(1)}% / {(wear.FR * 100).toFixed(1)}%
        </span>
        <span>Wear RL / RR</span>
        <span>
          {(wear.RL * 100).toFixed(1)}% / {(wear.RR * 100).toFixed(1)}%
        </span>
      </div>
    </section>
  );
}
