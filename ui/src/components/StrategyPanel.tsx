import { useState } from 'react';
import {
  type Compound,
  type Prediction,
  type StrategyResult,
  reoptimizeStrategy,
  COMPOUND_COLORS,
} from '../data/api';
import InfoTip from './InfoTip';

interface StrategyPanelProps {
  prediction: Prediction | null;
  compound: Compound;
  track: string;
  driver: string;
  currentLap: number;
  totalLaps: number;
}

export default function StrategyPanel({
  prediction,
  compound,
  track,
  driver,
  currentLap,
  totalLaps,
}: StrategyPanelProps) {
  const [reoptResult, setReoptResult] = useState<StrategyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [safetyCar, setSafetyCar] = useState(false);

  const handleReoptimize = async (isSC: boolean) => {
    setSafetyCar(isSC);
    setLoading(true);
    try {
      const result = await reoptimizeStrategy({
        track,
        driver,
        totalLaps,
        currentLap,
        currentCompound: compound,
        currentTyreLife: currentLap,
        pitsDone: 0,
        compoundsUsed: [compound.toUpperCase()],
        safetyCar: isSC,
      });
      setReoptResult(result);
    } catch {
      setReoptResult(null);
    } finally {
      setLoading(false);
    }
  };

  const best = reoptResult?.best_strategy;
  const alts = reoptResult?.all_strategies?.slice(1, 4) ?? [];

  return (
    <div className="strat-panel">
      <div className="strat-panel-header">
        <div>
          <InfoTip text="Evaluates every legal compound combination and pit lap to find the fastest total race time. Uses trained ML models for lap time prediction, pit stop duration, and in/out lap penalties per circuit.">
            <span className="strat-panel-title">Strategy Optimizer</span>
          </InfoTip>
          <span className="strat-panel-sub">ML-powered pit strategy</span>
        </div>
        <div className="strat-panel-actions">
          <InfoTip text="Recalculate the optimal strategy from the current lap forward, factoring in laps already completed and compound already in use.">
            <button
              className="strat-btn"
              onClick={() => handleReoptimize(false)}
              disabled={loading || !track}
            >
              {loading && !safetyCar ? 'Calculating…' : 'Reoptimize'}
            </button>
          </InfoTip>
          <InfoTip text="Trigger a safety car scenario — the model applies a ~12s pit cost discount (pitting under SC is cheaper because the field is neutralised) and re-evaluates whether to pit immediately or stay out.">
            <button
              className="strat-btn strat-btn-sc"
              onClick={() => handleReoptimize(true)}
              disabled={loading || !track}
            >
              <span className="sc-icon">SC</span>
              {loading && safetyCar ? 'Calculating…' : 'Safety Car'}
            </button>
          </InfoTip>
        </div>
      </div>

      {/* Current strategy from prediction */}
      {prediction && !best && (
        <div className="strat-current">
          <div className="strat-current-label">Current Optimal</div>
          <div className="strat-bar-large">
            <div
              className="strat-bar-stint"
              style={{
                flex: prediction.strategy_stint1_laps ?? 1,
                background: COMPOUND_COLORS[prediction.strategy_stint1_compound ?? 'medium'],
              }}
            >
              <span>{prediction.strategy_stint1_compound?.toUpperCase()}</span>
              <span>{prediction.strategy_stint1_laps}L</span>
            </div>
            <div className="strat-bar-pit">PIT</div>
            <div
              className="strat-bar-stint"
              style={{
                flex: prediction.strategy_stint2_laps ?? 1,
                background: COMPOUND_COLORS[prediction.strategy_stint2_compound ?? 'hard'],
              }}
            >
              <span>{prediction.strategy_stint2_compound?.toUpperCase()}</span>
              <span>{prediction.strategy_stint2_laps}L</span>
            </div>
          </div>
          <div className="strat-meta">
            Pit on lap {prediction.strategy_optimal_pit_lap} · Saves {prediction.strategy_time_saved_fmt}
          </div>
        </div>
      )}

      {/* Reoptimized result */}
      {best && (
        <div className="strat-reopt">
          <div className="strat-reopt-badge">
            {reoptResult?.mode === 'safety_car_reopt' ? (
              <><span className="sc-badge">SC</span> Safety Car Reoptimization</>
            ) : (
              <>Mid-Race Reoptimization</>
            )}
          </div>

          <div className="strat-reopt-best">
            <div className="strat-reopt-label">Recommended</div>
            <div className="strat-bar-large">
              {best.strategy.map((comp, i) => (
                <div key={i} style={{ display: 'contents' }}>
                  {i > 0 && <div className="strat-bar-pit">PIT L{best.pit_laps[i - 1]}</div>}
                  <div
                    className="strat-bar-stint"
                    style={{
                      flex: best.stint_times[i] ?? 1,
                      background: COMPOUND_COLORS[comp] ?? '#888',
                    }}
                  >
                    <span>{comp}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="strat-meta">
              {best.pit_laps.length > 0 && `Pit${best.pit_laps.length > 1 ? 's' : ''}: ${best.pit_laps.map((l) => `L${l}`).join(', ')} · `}
              Total: {best.total_time_formatted}
            </div>
          </div>

          {/* Alternatives */}
          {alts.length > 0 && (
            <div className="strat-alts">
              <div className="strat-alts-label">Alternatives</div>
              {alts.map((alt, idx) => {
                const delta = alt.total_time - best.total_time;
                return (
                  <div key={idx} className="strat-alt-row">
                    <div className="strat-bar-small">
                      {alt.strategy.map((comp, i) => (
                        <div
                          key={i}
                          style={{
                            flex: alt.stint_times[i] ?? 1,
                            background: COMPOUND_COLORS[comp] ?? '#888',
                            height: '100%',
                          }}
                        />
                      ))}
                    </div>
                    <span className="strat-alt-name">{alt.strategy_str}</span>
                    <span className="strat-alt-delta">+{delta.toFixed(1)}s</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
