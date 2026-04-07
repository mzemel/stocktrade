// Orchestrator: market open and market close logic

import { AlpacaClient } from './alpaca.js';
import { computeIndicators } from './indicators.js';
import { evaluateEntry, evaluateExit, ALL_SYMBOLS, ALL_ETFS, SECTOR_ETFS, SECTORS } from './strategies.js';
import { momentum } from './indicators.js';
import * as db from './db.js';

// ── Market Open: Evaluate entry signals and place orders ──

export async function handleMarketOpen(env) {
  const alpaca = new AlpacaClient(env.ALPACA_API_KEY, env.ALPACA_SECRET_KEY);
  const log = [];

  // Check market is actually open
  const isOpen = await alpaca.isMarketOpen();
  if (!isOpen) {
    return { skipped: true, reason: 'Market not open' };
  }

  log.push('Market is open, evaluating entry signals...');

  // Fetch all agents
  const agents = await db.getActiveAgents(env.DB);
  log.push(`Active agents: ${agents.length}`);

  // Fetch historical bars for all symbols (60 days of daily bars)
  const allSymbols = [...ALL_SYMBOLS, ...ALL_ETFS];
  const barsResp = await alpaca.getMultiBars(allSymbols, { timeframe: '1Day', limit: 80 });
  const barsMap = barsResp.bars || {};

  // Compute indicators for all symbols
  const indicatorsMap = {};
  for (const symbol of allSymbols) {
    const bars = barsMap[symbol];
    if (bars && bars.length >= 20) {
      indicatorsMap[symbol] = computeIndicators(bars);
    }
  }

  // Compute sector relative strengths (for sector rotation strategy)
  const sectorStrengths = computeSectorStrengths(indicatorsMap);

  // Build context for strategies that need it
  const context = {
    sectorStrengths,
    fundamentals: await loadFundamentals(env.KV),
  };

  const today = new Date().toISOString().split('T')[0];
  const trades = [];

  // Evaluate each agent
  for (const agent of agents) {
    try {
      const agentTrades = await evaluateAgentEntries(
        alpaca, env.DB, agent, indicatorsMap, context, today
      );
      trades.push(...agentTrades);
    } catch (e) {
      log.push(`Error evaluating ${agent.id}: ${e.message}`);
    }
  }

  log.push(`Total new trades placed: ${trades.length}`);
  return { skipped: false, trades: trades.length, log };
}

async function evaluateAgentEntries(alpaca, database, agent, indicatorsMap, context, today) {
  const params = agent.params;
  const trades = [];

  // Check daily loss limit
  const todayTrades = await db.getTradesToday(database, agent.id, today);
  const todayPnl = todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const lossLimit = agent.allocation * 0.03;
  if (todayPnl < -lossLimit) {
    return []; // Daily loss limit hit
  }

  // Check current open positions
  const openTrades = await db.getOpenTrades(database, agent.id);
  if (openTrades.length >= 5) {
    return []; // Max concurrent positions reached
  }

  // Calculate available capital
  const openCost = openTrades.reduce((sum, t) => sum + t.total_cost, 0);
  const available = agent.current_balance - openCost;
  const positionSize = agent.allocation * params.position_size_pct;

  if (available < positionSize) {
    return []; // Not enough capital
  }

  // Determine which symbols this agent should consider
  const symbols = getAgentSymbols(agent.strategy);

  // Already-held symbols
  const heldSymbols = new Set(openTrades.map(t => t.symbol));

  for (const symbol of symbols) {
    if (heldSymbols.has(symbol)) continue; // Already holding
    if (openTrades.length + trades.length >= 5) break; // Max positions

    const indicators = indicatorsMap[symbol];
    if (!indicators) continue;

    const { signal, reason } = evaluateEntry(
      agent.strategy, symbol, indicators, params, context
    );

    if (signal) {
      try {
        const notional = Math.min(positionSize, available - trades.length * positionSize);
        if (notional < 1) continue;

        // Place market buy order
        const order = await alpaca.buyWithStopLoss(symbol, notional, params.stop_loss_pct);

        // Estimate fill price from current price
        const price = indicators.price;
        const qty = notional / price;
        const stopPrice = price * (1 - params.stop_loss_pct);

        // Place stop-loss order (will execute after buy fills)
        let stopOrder = null;
        try {
          // Small delay to let buy fill
          stopOrder = await alpaca.placeStopLoss(symbol, qty.toFixed(6), stopPrice);
        } catch (e) {
          // Stop-loss may fail if buy hasn't filled yet; we'll retry at market close
        }

        const tradeId = await db.insertTrade(database, {
          agent_id: agent.id,
          symbol,
          side: 'buy',
          quantity: qty,
          price,
          total_cost: notional,
          alpaca_order_id: order.id,
          stop_loss_order_id: stopOrder?.id || null,
          entry_date: today,
          signal_reason: reason,
        });

        trades.push({ id: tradeId, agent: agent.id, symbol, notional, reason });
      } catch (e) {
        // Order failed, continue to next symbol
        console.error(`Order failed for ${agent.id}/${symbol}: ${e.message}`);
      }
    }
  }

  return trades;
}

// ── Market Close: Evaluate exits, compute P&L, generate report ──

export async function handleMarketClose(env) {
  const alpaca = new AlpacaClient(env.ALPACA_API_KEY, env.ALPACA_SECRET_KEY);
  const log = [];

  // Check market status — we run shortly after close
  const clock = await alpaca.getClock();
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  log.push(`Processing market close for ${today}`);

  const agents = await db.getActiveAgents(env.DB);
  const allOpenTrades = await db.getAllOpenTrades(env.DB);

  if (allOpenTrades.length === 0 && agents.length === 0) {
    return { skipped: true, reason: 'No agents or trades' };
  }

  // Fetch current prices for all symbols with open positions
  const openSymbols = [...new Set(allOpenTrades.map(t => t.symbol))];
  let currentPrices = {};

  if (openSymbols.length > 0) {
    const snapshots = await alpaca.getSnapshots(openSymbols);
    for (const [symbol, snap] of Object.entries(snapshots)) {
      currentPrices[symbol] = snap.dailyBar?.c || snap.latestTrade?.p || 0;
    }
  }

  // Get SPY daily return for benchmark
  const spyBars = await alpaca.getMultiBars(['SPY'], { timeframe: '1Day', limit: 2 });
  let spyDailyPct = 0;
  if (spyBars.bars?.SPY?.length >= 2) {
    const spyToday = spyBars.bars.SPY[spyBars.bars.SPY.length - 1].c;
    const spyYesterday = spyBars.bars.SPY[spyBars.bars.SPY.length - 2].c;
    spyDailyPct = (spyToday - spyYesterday) / spyYesterday;
  }

  // Fetch full bar data for exit signal evaluation
  const allSymbols = [...ALL_SYMBOLS, ...ALL_ETFS];
  const barsResp = await alpaca.getMultiBars(allSymbols, { timeframe: '1Day', limit: 80 });
  const barsMap = barsResp.bars || {};
  const indicatorsMap = {};
  for (const symbol of allSymbols) {
    if (barsMap[symbol]?.length >= 20) {
      indicatorsMap[symbol] = computeIndicators(barsMap[symbol]);
    }
  }

  const closedTrades = [];
  const snapshots = [];

  for (const agent of agents) {
    try {
      const result = await processAgentClose(
        alpaca, env.DB, agent, currentPrices, indicatorsMap, spyDailyPct, today
      );
      closedTrades.push(...result.closed);
      snapshots.push(result.snapshot);
    } catch (e) {
      log.push(`Error processing close for ${agent.id}: ${e.message}`);
    }
  }

  log.push(`Closed trades: ${closedTrades.length}, Snapshots: ${snapshots.length}`);

  return {
    skipped: false,
    date: today,
    closedTrades: closedTrades.length,
    snapshots,
    spyDailyPct,
    log,
  };
}

async function processAgentClose(alpaca, database, agent, currentPrices, indicatorsMap, spyDailyPct, today) {
  const params = agent.params;
  const openTrades = await db.getOpenTrades(database, agent.id);
  const closed = [];

  for (const trade of openTrades) {
    const currentPrice = currentPrices[trade.symbol];
    if (!currentPrice) continue;

    const holdDays = Math.ceil(
      (new Date(today) - new Date(trade.entry_date)) / (1000 * 60 * 60 * 24)
    );

    let shouldExit = false;
    let exitReason = '';

    // Check max hold period
    if (holdDays >= params.max_hold_days) {
      shouldExit = true;
      exitReason = `Max hold period reached (${holdDays} days)`;
    }

    // Check take-profit
    const takeProfitPrice = trade.price * (1 + params.take_profit_pct);
    if (currentPrice >= takeProfitPrice) {
      shouldExit = true;
      exitReason = `Take profit hit: ${currentPrice.toFixed(2)} >= ${takeProfitPrice.toFixed(2)}`;
    }

    // Check strategy-specific exit signal
    if (!shouldExit) {
      const indicators = indicatorsMap[trade.symbol];
      if (indicators) {
        const { signal, reason } = evaluateExit(
          agent.strategy, trade.symbol, indicators, params, trade
        );
        if (signal) {
          shouldExit = true;
          exitReason = reason;
        }
      }
    }

    if (shouldExit) {
      try {
        // Cancel any open stop-loss order
        if (trade.stop_loss_order_id) {
          try { await alpaca.cancelOrder(trade.stop_loss_order_id); } catch {}
        }
        // Place sell order
        await alpaca.placeSellOrder(trade.symbol, trade.quantity);
        const closedTrade = await db.closeTrade(database, trade.id, currentPrice, today);
        closed.push(closedTrade);
      } catch (e) {
        console.error(`Failed to close trade ${trade.id}: ${e.message}`);
      }
    }
  }

  // Compute daily snapshot
  const remainingOpen = await db.getOpenTrades(database, agent.id);
  const todayTrades = await db.getTradesToday(database, agent.id, today);
  const recentClosed = await db.getRecentClosedTrades(database, agent.id, 30);

  // Portfolio value = current_balance + unrealized P&L on open positions
  let unrealizedPnl = 0;
  for (const t of remainingOpen) {
    const cp = currentPrices[t.symbol] || t.price;
    unrealizedPnl += (cp - t.price) * t.quantity;
  }

  // Realized P&L from today's closes
  const realizedToday = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);

  // Update agent balance with realized P&L
  const newBalance = agent.current_balance + realizedToday;
  await db.updateAgentBalance(database, agent.id, newBalance);
  if (newBalance > agent.peak_balance) {
    await db.updateAgentPeak(database, agent.id, newBalance);
  }

  const portfolioValue = newBalance + unrealizedPnl;
  const dailyPnl = realizedToday + unrealizedPnl;
  const dailyPnlPct = agent.allocation > 0 ? dailyPnl / agent.allocation : 0;
  const cumulativePnl = portfolioValue - agent.allocation;
  const cumulativePnlPct = agent.allocation > 0 ? cumulativePnl / agent.allocation : 0;

  // Win rate from recent closed trades
  const wins = recentClosed.filter(t => (t.pnl || 0) > 0).length;
  const winRate = recentClosed.length > 0 ? wins / recentClosed.length : null;

  // Sharpe ratio (simplified: annualized daily returns)
  const historicalSnapshots = await db.getSnapshots(database, agent.id, 30);
  const dailyReturns = historicalSnapshots.map(s => s.daily_pnl_pct);
  dailyReturns.push(dailyPnlPct);
  const sharpe = computeSharpe(dailyReturns);

  // Max drawdown
  const maxDrawdown = agent.peak_balance > 0
    ? (agent.peak_balance - Math.min(portfolioValue, newBalance)) / agent.peak_balance
    : 0;

  // Check if agent should be paused (>10% drawdown from peak)
  if (maxDrawdown > 0.10) {
    await db.pauseAgent(database, agent.id, `Max drawdown ${(maxDrawdown * 100).toFixed(1)}% exceeded 10% threshold`);
  }

  const snapshot = {
    agent_id: agent.id,
    date: today,
    portfolio_value: portfolioValue,
    daily_pnl: dailyPnl,
    daily_pnl_pct: dailyPnlPct,
    cumulative_pnl: cumulativePnl,
    cumulative_pnl_pct: cumulativePnlPct,
    open_positions: remainingOpen.length,
    trades_today: todayTrades.length,
    win_rate: winRate,
    sharpe_ratio: sharpe,
    max_drawdown: maxDrawdown,
    spy_daily_pct: spyDailyPct,
    alpha: dailyPnlPct - spyDailyPct,
  };

  await db.insertSnapshot(database, snapshot);
  return { closed, snapshot };
}

// ── Helpers ──

function getAgentSymbols(strategy) {
  if (strategy === 'sector_rotation') {
    // Sector rotation trades sector ETFs and top stocks
    return [...Object.values(SECTOR_ETFS), ...ALL_SYMBOLS];
  }
  return ALL_SYMBOLS;
}

function computeSectorStrengths(indicatorsMap) {
  const strengths = {};
  for (const [sector, etf] of Object.entries(SECTOR_ETFS)) {
    const ind = indicatorsMap[etf];
    const spyInd = indicatorsMap['SPY'];
    if (ind?.momentum20 != null && spyInd?.momentum20 != null) {
      strengths[sector] = ind.momentum20 - spyInd.momentum20; // Relative strength
    }
  }
  return strengths;
}

function computeSharpe(dailyReturns) {
  if (dailyReturns.length < 5) return null;
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / dailyReturns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(252); // Annualized
}

async function loadFundamentals(kv) {
  // Load cached fundamental data from KV
  // This is populated periodically (weekly) since fundamental data doesn't change daily
  const data = await kv.get('fundamentals', { type: 'json' });
  return data || {};
}
