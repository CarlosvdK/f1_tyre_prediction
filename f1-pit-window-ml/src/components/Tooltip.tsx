interface TooltipProps {
  visible: boolean;
  x: number;
  y: number;
  label: string;
}

export default function Tooltip({ visible, x, y, label }: TooltipProps) {
  if (!visible) {
    return null;
  }

  return (
    <div
      className="hover-tooltip"
      style={{
        left: `${x}px`,
        top: `${y}px`,
      }}
    >
      {label}
    </div>
  );
}
