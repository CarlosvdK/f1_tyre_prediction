interface TooltipProps {
  visible: boolean;
  tireId?: string;
  wearPct?: number;
  tempProxyC?: number;
}

export default function Tooltip({ visible, tireId, wearPct, tempProxyC }: TooltipProps) {
  if (!visible || !tireId) {
    return null;
  }

  return (
    <aside className="hover-tooltip-card">
      <header>{tireId} tyre detail</header>
      <div className="hover-tooltip-grid">
        <span>Wear</span>
        <strong>{(wearPct ?? 0).toFixed(1)}%</strong>
        <span>Temp proxy</span>
        <strong>{tempProxyC ?? 0} C</strong>
      </div>
    </aside>
  );
}
