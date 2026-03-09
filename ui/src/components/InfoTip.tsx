import { useState } from 'react';

interface InfoTipProps {
  text: string;
  children: React.ReactNode;
}

export default function InfoTip({ text, children }: InfoTipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="info-tip-wrap"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span className="info-tip-bubble">
          {text}
        </span>
      )}
    </span>
  );
}
