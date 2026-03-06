declare module 'plotly.js-basic-dist' {
  const Plotly: unknown;
  export default Plotly;
}

declare module 'react-plotly.js/factory' {
  import type { ComponentType } from 'react';

  export default function createPlotlyComponent(plotly: unknown): ComponentType<any>;
}
