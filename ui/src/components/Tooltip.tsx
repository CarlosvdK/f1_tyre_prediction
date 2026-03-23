import type { Compound, Prediction } from '../data/api';

interface TooltipProps {
  visible: boolean;
  tireId?: string;
  wearPct?: number;
  wearByTire?: Partial<Record<'FL' | 'FR' | 'RL' | 'RR', number>>;
  tempProxyC?: number;
  compound?: Compound;
  prediction?: Prediction | null;
  currentLap?: number;
  lapsOnTire?: number;
  tyreLifePct?: number;
}

const COMPOUND_LABELS: Record<string, string> = {
  soft: 'SOFT',
  medium: 'MEDIUM',
  hard: 'HARD',
  inter: 'INTERMEDIATE',
  wet: 'WET',
};

const EXPECTED_LIFE: Record<string, number> = {
  soft: 18,
  medium: 28,
  hard: 40,
  inter: 24,
  wet: 30,
};

function wearColor(pct: number): string {
  if (pct < 30) return '#36e888';
  if (pct < 60) return '#f5c842';
  if (pct < 80) return '#ff9040';
  return '#e10600';
}

function wearBar(value: number): string {
  return `${Math.min(100, Math.max(0, value * 100))}%`;
}

export default function Tooltip({
  visible,
  tireId,
  wearPct,
  wearByTire,
  tempProxyC,
  compound,
  prediction,
  currentLap,
  lapsOnTire,
  tyreLifePct,
}: TooltipProps) {
  if (!visible || !tireId) return null;

  const wear = wearPct ?? 0;
  const temp = tempProxyC ?? 0;
  const life = tyreLifePct ?? prediction?.tyre_life_pct ?? (100 - wear);
  const compLabel = COMPOUND_LABELS[compound ?? 'medium'] ?? 'MEDIUM';
  const expectedLife = EXPECTED_LIFE[compound ?? 'medium'] ?? 28;
  const lapsUsed = lapsOnTire ?? currentLap ?? 1;
  const lapsRemaining = Math.max(0, Math.round(expectedLife - lapsUsed));

  // Get per-tyre wear from prediction
  const tireWearMap: Record<string, number> = {
    FL: wearByTire?.FL ?? prediction?.wear_FL ?? wear / 100,
    FR: wearByTire?.FR ?? prediction?.wear_FR ?? wear / 100,
    RL: wearByTire?.RL ?? prediction?.wear_RL ?? wear / 100,
    RR: wearByTire?.RR ?? prediction?.wear_RR ?? wear / 100,
  };
  const thisWear = tireWearMap[tireId] ?? wear / 100;
  const thisWearPct = thisWear * 100;

  // Pressure / temp proxy per corner
  const basePressure = compound === 'soft' ? 23.5 : compound === 'hard' ? 25.0 : 24.2;
  const pressureDelta = thisWear * 1.8;
  const pressure = (basePressure + pressureDelta).toFixed(1);

  // Grain / blister risk
  const grainRisk = thisWear < 0.15 ? 'High' : thisWear < 0.35 ? 'Medium' : 'Low';
  const blisterRisk = thisWear > 0.7 ? 'High' : thisWear > 0.45 ? 'Medium' : 'Low';

  return (
    <aside className="hover-tooltip-card tyre-detail-card">
      <header>
        <span className="tooltip-tire-id">{tireId}</span>
        <span className={`tooltip-compound bg-${compound}`}>{compLabel}</span>
      </header>

      {/* Wear bar */}
      <div className="tooltip-wear-section">
        <div className="tooltip-wear-header">
          <span>Wear</span>
          <strong style={{ color: wearColor(thisWearPct) }}>{thisWearPct.toFixed(1)}%</strong>
        </div>
        <div className="tooltip-wear-track">
          <div
            className="tooltip-wear-fill"
            style={{
              width: wearBar(thisWear),
              background: `linear-gradient(90deg, #36e888, ${wearColor(thisWearPct)})`,
            }}
          />
        </div>
      </div>

      {/* Metrics grid */}
      <div className="tooltip-metrics">
        <div className="tooltip-metric-row" title="Overall tyre performance remaining, predicted by the ML wear model based on laps driven, compound, and circuit characteristics">
          <span>Tyre Life</span>
          <strong>{life.toFixed(0)}%</strong>
        </div>
        <div className="tooltip-metric-row" title="Estimated rubber surface temperature — rises with wear as the tyre degrades and generates more friction">
          <span>Surface Temp</span>
          <strong>{temp}°C</strong>
        </div>
        <div className="tooltip-metric-row" title="Internal tyre pressure — increases slightly as wear progresses due to heat build-up in the carcass">
          <span>Pressure</span>
          <strong>{pressure} psi</strong>
        </div>
        <div className="tooltip-metric-row" title="Number of racing laps completed on this set of tyres since the last pit stop">
          <span>Laps Done</span>
          <strong>{lapsUsed}</strong>
        </div>
        <div className="tooltip-metric-row" title="Estimated laps before the tyre hits its performance cliff — based on typical compound lifespan minus laps already driven">
          <span>Est. Remaining</span>
          <strong>{lapsRemaining} laps</strong>
        </div>
      </div>

      {/* Risk indicators */}
      <div className="tooltip-risks">
        <div className={`tooltip-risk risk-${grainRisk.toLowerCase()}`} title="Graining occurs on fresh tyres when the surface isn't up to temperature — small rubber pellets form and reduce grip. Higher risk in early stint laps.">
          <span className="tooltip-risk-dot" />
          Graining: {grainRisk}
        </div>
        <div className={`tooltip-risk risk-${blisterRisk.toLowerCase()}`} title="Blistering happens when tyres overheat — gas bubbles form under the surface, causing chunks of rubber to tear off. Higher risk in late stint when wear is high.">
          <span className="tooltip-risk-dot" />
          Blistering: {blisterRisk}
        </div>
      </div>
    </aside>
  );
}
