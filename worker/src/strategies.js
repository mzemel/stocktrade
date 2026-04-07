// Strategy signal evaluators
// Each returns { signal: boolean, reason: string } for entry/exit decisions

import { computeIndicators } from './indicators.js';

// Stock universe organized by sector
export const SECTORS = {
  tech: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META'],
  energy: ['XOM', 'CVX', 'COP', 'SLB', 'EOG'],
  finance: ['JPM', 'BAC', 'GS', 'MS'],
  healthcare: ['JNJ', 'UNH', 'PFE', 'ABBV', 'MRK'],
  consumer: ['WMT', 'PG', 'KO', 'MCD', 'NKE'],
  industrial: ['CAT', 'HON', 'UPS', 'GE'],
};

// Sector ETFs for relative strength comparison
export const SECTOR_ETFS = {
  tech: 'XLK',
  energy: 'XLE',
  finance: 'XLF',
  healthcare: 'XLV',
  consumer: 'XLP',
  industrial: 'XLI',
};

export const ALL_SYMBOLS = Object.values(SECTORS).flat();
export const ALL_ETFS = [...Object.values(SECTOR_ETFS), 'SPY'];
export const ALL_TRADEABLE = [...ALL_SYMBOLS, ...ALL_ETFS];

// Get sector for a symbol
export function getSector(symbol) {
  for (const [sector, symbols] of Object.entries(SECTORS)) {
    if (symbols.includes(symbol)) return sector;
  }
  return null;
}

// ── Strategy Evaluators ──

export function evaluateEntry(strategy, symbol, indicators, params, context = {}) {
  switch (strategy) {
    case 'momentum': return momentumEntry(symbol, indicators, params);
    case 'mean_reversion': return meanReversionEntry(symbol, indicators, params);
    case 'trend_following': return trendFollowingEntry(symbol, indicators, params);
    case 'volatility_breakout': return volatilityBreakoutEntry(symbol, indicators, params);
    case 'sector_rotation': return sectorRotationEntry(symbol, indicators, params, context);
    case 'value': return valueEntry(symbol, indicators, params, context);
    default: return { signal: false, reason: 'Unknown strategy' };
  }
}

export function evaluateExit(strategy, symbol, indicators, params, trade) {
  switch (strategy) {
    case 'momentum': return momentumExit(symbol, indicators, params, trade);
    case 'mean_reversion': return meanReversionExit(symbol, indicators, params, trade);
    case 'trend_following': return trendFollowingExit(symbol, indicators, params, trade);
    case 'volatility_breakout': return volatilityBreakoutExit(symbol, indicators, params, trade);
    case 'sector_rotation': return sectorRotationExit(symbol, indicators, params, trade);
    case 'value': return valueExit(symbol, indicators, params, trade);
    default: return { signal: false, reason: 'Unknown strategy' };
  }
}

// ── Momentum ──

function momentumEntry(symbol, ind, params) {
  const lookback = params.lookback_days || 20;
  const threshold = params.entry_threshold || 0.75;

  const mom = lookback === 10 ? ind.momentum10 :
              lookback === 30 ? ind.momentum30 : ind.momentum20;
  const shortMom = ind.momentum5;

  if (mom === null || shortMom === null) {
    return { signal: false, reason: 'Insufficient data for momentum' };
  }

  // Entry: strong momentum AND positive short-term trend
  if (mom > 0.05 * threshold && shortMom > 0) {
    return { signal: true, reason: `Momentum ${(mom * 100).toFixed(1)}% over ${lookback}d, 5d trend positive at ${(shortMom * 100).toFixed(1)}%` };
  }
  return { signal: false, reason: `Momentum ${(mom * 100).toFixed(1)}% below threshold` };
}

function momentumExit(symbol, ind, params, trade) {
  const mom = ind.momentum20;
  if (mom !== null && mom < 0) {
    return { signal: true, reason: `Momentum turned negative: ${(mom * 100).toFixed(1)}%` };
  }
  return { signal: false, reason: 'Momentum still positive' };
}

// ── Mean Reversion ──

function meanReversionEntry(symbol, ind, params) {
  const rsiPeriod = params.rsi_period || 14;
  const entryRsi = params.entry_rsi || 30;

  const rsiVal = rsiPeriod === 7 ? ind.rsi7 : rsiPeriod === 21 ? ind.rsi21 : ind.rsi14;
  if (rsiVal === null) {
    return { signal: false, reason: 'Insufficient data for RSI' };
  }

  // Entry: RSI oversold
  if (rsiVal < entryRsi) {
    return { signal: true, reason: `RSI(${rsiPeriod}) = ${rsiVal.toFixed(1)} < ${entryRsi} (oversold)` };
  }
  return { signal: false, reason: `RSI(${rsiPeriod}) = ${rsiVal.toFixed(1)} above entry threshold` };
}

function meanReversionExit(symbol, ind, params, trade) {
  const rsiPeriod = params.rsi_period || 14;
  const exitRsi = params.exit_rsi || 50;
  const rsiVal = rsiPeriod === 7 ? ind.rsi7 : rsiPeriod === 21 ? ind.rsi21 : ind.rsi14;

  if (rsiVal !== null && rsiVal > exitRsi) {
    return { signal: true, reason: `RSI(${rsiPeriod}) = ${rsiVal.toFixed(1)} > ${exitRsi} (recovered)` };
  }
  return { signal: false, reason: `RSI still below exit threshold` };
}

// ── Trend Following ──

function trendFollowingEntry(symbol, ind, params) {
  const shortPeriod = params.short_ma || 10;
  const longPeriod = params.long_ma || 30;

  const shortMA = getMA(ind, shortPeriod);
  const longMA = getMA(ind, longPeriod);

  if (shortMA === null || longMA === null) {
    return { signal: false, reason: 'Insufficient data for MAs' };
  }

  // Entry: short MA above long MA AND price above long MA
  if (shortMA > longMA && ind.price > longMA) {
    return { signal: true, reason: `SMA(${shortPeriod})=${shortMA.toFixed(2)} > SMA(${longPeriod})=${longMA.toFixed(2)}, price above trend` };
  }
  return { signal: false, reason: `No bullish MA crossover` };
}

function trendFollowingExit(symbol, ind, params, trade) {
  const shortPeriod = params.short_ma || 10;
  const longPeriod = params.long_ma || 30;
  const shortMA = getMA(ind, shortPeriod);
  const longMA = getMA(ind, longPeriod);

  if (shortMA !== null && longMA !== null && shortMA < longMA) {
    return { signal: true, reason: `SMA(${shortPeriod}) crossed below SMA(${longPeriod})` };
  }
  return { signal: false, reason: 'Trend still intact' };
}

// ── Volatility Breakout ──

function volatilityBreakoutEntry(symbol, ind, params) {
  const bbPeriod = params.bb_period || 20;
  const volThreshold = params.volume_threshold || 1.5;

  const bb = bbPeriod === 10 ? ind.bb10 : bbPeriod === 30 ? ind.bb30 : ind.bb20;
  if (!bb || ind.avgVolume20 === null) {
    return { signal: false, reason: 'Insufficient data for Bollinger Bands' };
  }

  const volumeRatio = ind.volume / ind.avgVolume20;

  // Entry: price above upper band on high volume
  if (ind.price > bb.upper && volumeRatio > volThreshold) {
    return { signal: true, reason: `Price ${ind.price.toFixed(2)} > BB upper ${bb.upper.toFixed(2)}, volume ${volumeRatio.toFixed(1)}x avg` };
  }
  return { signal: false, reason: 'No breakout detected' };
}

function volatilityBreakoutExit(symbol, ind, params, trade) {
  const bbPeriod = params.bb_period || 20;
  const bb = bbPeriod === 10 ? ind.bb10 : bbPeriod === 30 ? ind.bb30 : ind.bb20;

  if (bb && ind.price < bb.middle) {
    return { signal: true, reason: `Price ${ind.price.toFixed(2)} fell below BB middle ${bb.middle.toFixed(2)}` };
  }
  return { signal: false, reason: 'Price still above BB middle' };
}

// ── Sector Rotation ──

function sectorRotationEntry(symbol, ind, params, context) {
  const { sectorStrengths } = context;
  if (!sectorStrengths) {
    return { signal: false, reason: 'No sector strength data available' };
  }

  const sector = getSector(symbol);
  if (!sector) return { signal: false, reason: 'Symbol not in a tracked sector' };

  const topN = params.top_n_sectors || 2;
  const sortedSectors = Object.entries(sectorStrengths)
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);

  const topSectors = sortedSectors.slice(0, topN);
  if (topSectors.includes(sector)) {
    const rank = topSectors.indexOf(sector) + 1;
    return { signal: true, reason: `${sector} sector ranked #${rank} by relative strength (${(sectorStrengths[sector] * 100).toFixed(1)}%)` };
  }
  return { signal: false, reason: `${sector} not in top ${topN} sectors` };
}

function sectorRotationExit(symbol, ind, params, trade) {
  // Exit handled by hold period and stop-loss primarily
  return { signal: false, reason: 'Sector rotation exit via hold period' };
}

// ── Value ──

function valueEntry(symbol, ind, params, context) {
  const { fundamentals } = context;
  if (!fundamentals || !fundamentals[symbol]) {
    return { signal: false, reason: 'No fundamental data available' };
  }

  const f = fundamentals[symbol];
  const peThreshold = params.pe_threshold_pctile || 0.25;
  const minDivYield = params.min_dividend_yield || 0.02;

  // Simple value check: low P/E and decent dividend
  // Note: In paper mode, we'll use basic heuristics since we don't have a full fundamental data feed
  if (f.pe_ratio && f.pe_ratio < 20 && f.pe_ratio > 0) {
    if (f.dividend_yield && f.dividend_yield > minDivYield) {
      return { signal: true, reason: `P/E ${f.pe_ratio.toFixed(1)} (low), div yield ${(f.dividend_yield * 100).toFixed(1)}%` };
    }
  }
  return { signal: false, reason: 'Does not meet value criteria' };
}

function valueExit(symbol, ind, params, trade) {
  // Value exits primarily on hold period and stop-loss
  return { signal: false, reason: 'Value exit via hold period' };
}

// ── Helpers ──

function getMA(ind, period) {
  const key = `sma${period}`;
  return ind[key] || null;
}
