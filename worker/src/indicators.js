// Technical indicator calculations
// All functions expect arrays of numbers (prices or volumes), most recent last

// Simple Moving Average
export function sma(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

// Exponential Moving Average
export function ema(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let emaVal = sma(prices.slice(0, period), period);
  for (let i = period; i < prices.length; i++) {
    emaVal = prices[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

// Relative Strength Index
export function rsi(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let gains = 0;
  let losses = 0;

  // Initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Smooth with subsequent data
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - change) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Bollinger Bands
export function bollingerBands(prices, period = 20, numStd = 2) {
  if (prices.length < period) return null;
  const middle = sma(prices, period);
  const slice = prices.slice(-period);
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
  const std = Math.sqrt(variance);
  return {
    upper: middle + numStd * std,
    middle,
    lower: middle - numStd * std,
    std,
  };
}

// Momentum (percentage return over lookback period)
export function momentum(prices, period = 20) {
  if (prices.length < period + 1) return null;
  const current = prices[prices.length - 1];
  const past = prices[prices.length - 1 - period];
  if (past === 0) return null;
  return (current - past) / past;
}

// Average volume over period
export function avgVolume(volumes, period = 20) {
  return sma(volumes, period);
}

// Standard deviation
export function stdDev(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / period;
  return Math.sqrt(variance);
}

// Compute all indicators for a symbol given its bar data
// bars: array of { c (close), v (volume), h (high), l (low), o (open) }
export function computeIndicators(bars) {
  const closes = bars.map(b => b.c);
  const volumes = bars.map(b => b.v);
  const highs = bars.map(b => b.h);
  const lows = bars.map(b => b.l);

  return {
    price: closes[closes.length - 1],
    prevPrice: closes.length > 1 ? closes[closes.length - 2] : null,
    sma5: sma(closes, 5),
    sma10: sma(closes, 10),
    sma15: sma(closes, 15),
    sma20: sma(closes, 20),
    sma30: sma(closes, 30),
    sma50: sma(closes, 50),
    sma60: sma(closes, 60),
    rsi7: rsi(closes, 7),
    rsi14: rsi(closes, 14),
    rsi21: rsi(closes, 21),
    bb10: bollingerBands(closes, 10, 1.5),
    bb20: bollingerBands(closes, 20, 2),
    bb30: bollingerBands(closes, 30, 2),
    momentum5: momentum(closes, 5),
    momentum10: momentum(closes, 10),
    momentum20: momentum(closes, 20),
    momentum30: momentum(closes, 30),
    volume: volumes[volumes.length - 1],
    avgVolume20: avgVolume(volumes, 20),
    high52w: highs.length >= 252 ? Math.max(...highs.slice(-252)) : Math.max(...highs),
    low52w: lows.length >= 252 ? Math.min(...lows.slice(-252)) : Math.min(...lows),
    closes,
    volumes,
  };
}
