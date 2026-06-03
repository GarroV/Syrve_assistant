export interface DeltaResult {
  delta_percent: number;
  is_alert: boolean;
}

export function computeDelta(opts: {
  currentPrice: number;
  oldPrice: number;
  threshold: number;
}): DeltaResult {
  const { currentPrice, oldPrice, threshold } = opts;
  const raw = ((currentPrice - oldPrice) / oldPrice) * 100;
  const delta_percent = Math.round(raw * 100) / 100;
  return {
    delta_percent,
    is_alert: Math.abs(delta_percent) >= threshold,
  };
}
