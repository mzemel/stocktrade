// D1 database helpers

export function generateId() {
  return crypto.randomUUID();
}

export async function getActiveAgents(db) {
  const { results } = await db.prepare(
    'SELECT * FROM agents WHERE is_active = 1'
  ).all();
  return results.map(a => ({ ...a, params: JSON.parse(a.params) }));
}

export async function getAgent(db, agentId) {
  const row = await db.prepare('SELECT * FROM agents WHERE id = ?').bind(agentId).first();
  if (!row) return null;
  return { ...row, params: JSON.parse(row.params) };
}

export async function updateAgentBalance(db, agentId, balance) {
  await db.prepare(
    'UPDATE agents SET current_balance = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(balance, agentId).run();
}

export async function updateAgentPeak(db, agentId, peak) {
  await db.prepare(
    'UPDATE agents SET peak_balance = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(peak, agentId).run();
}

export async function pauseAgent(db, agentId, reason) {
  await db.prepare(
    'UPDATE agents SET is_active = 0, paused_reason = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(reason, agentId).run();
}

export async function updateAgentParams(db, agentId, newParams) {
  await db.prepare(
    'UPDATE agents SET params = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(JSON.stringify(newParams), agentId).run();
}

// ── Trades ──

export async function insertTrade(db, trade) {
  const id = generateId();
  await db.prepare(`
    INSERT INTO trades (id, agent_id, symbol, side, quantity, price, total_cost, alpaca_order_id, stop_loss_order_id, status, entry_date, signal_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).bind(
    id, trade.agent_id, trade.symbol, trade.side, trade.quantity,
    trade.price, trade.total_cost, trade.alpaca_order_id || null,
    trade.stop_loss_order_id || null, trade.entry_date, trade.signal_reason || null
  ).run();
  return id;
}

export async function closeTrade(db, tradeId, exitPrice, exitDate) {
  const trade = await db.prepare('SELECT * FROM trades WHERE id = ?').bind(tradeId).first();
  if (!trade) return null;
  const pnl = (exitPrice - trade.price) * trade.quantity;
  const pnlPct = (exitPrice - trade.price) / trade.price;
  const entryDate = new Date(trade.entry_date);
  const exit = new Date(exitDate);
  const holdDays = Math.ceil((exit - entryDate) / (1000 * 60 * 60 * 24));

  await db.prepare(`
    UPDATE trades SET status = 'closed', exit_date = ?, exit_price = ?, pnl = ?, pnl_pct = ?, hold_days = ?
    WHERE id = ?
  `).bind(exitDate, exitPrice, pnl, pnlPct, holdDays, tradeId).run();
  return { ...trade, exit_price: exitPrice, pnl, pnl_pct: pnlPct, hold_days: holdDays };
}

export async function getOpenTrades(db, agentId) {
  const { results } = await db.prepare(
    'SELECT * FROM trades WHERE agent_id = ? AND status = \'open\''
  ).bind(agentId).all();
  return results;
}

export async function getOpenTradeBySymbol(db, agentId, symbol) {
  return db.prepare(
    'SELECT * FROM trades WHERE agent_id = ? AND symbol = ? AND status = \'open\''
  ).bind(agentId, symbol).first();
}

export async function getAllOpenTrades(db) {
  const { results } = await db.prepare(
    'SELECT * FROM trades WHERE status = \'open\''
  ).all();
  return results;
}

export async function getRecentClosedTrades(db, agentId, days = 30) {
  const { results } = await db.prepare(
    'SELECT * FROM trades WHERE agent_id = ? AND status = \'closed\' AND exit_date >= datetime(\'now\', ? || \' days\') ORDER BY exit_date DESC'
  ).bind(agentId, -days).all();
  return results;
}

export async function getTradesToday(db, agentId, date) {
  const { results } = await db.prepare(
    'SELECT * FROM trades WHERE agent_id = ? AND entry_date = ?'
  ).bind(agentId, date).all();
  return results;
}

// ── Snapshots ──

export async function insertSnapshot(db, snapshot) {
  const id = generateId();
  await db.prepare(`
    INSERT OR REPLACE INTO daily_snapshots
    (id, agent_id, date, portfolio_value, daily_pnl, daily_pnl_pct, cumulative_pnl, cumulative_pnl_pct,
     open_positions, trades_today, win_rate, sharpe_ratio, max_drawdown, spy_daily_pct, alpha)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, snapshot.agent_id, snapshot.date, snapshot.portfolio_value,
    snapshot.daily_pnl, snapshot.daily_pnl_pct, snapshot.cumulative_pnl,
    snapshot.cumulative_pnl_pct, snapshot.open_positions, snapshot.trades_today,
    snapshot.win_rate, snapshot.sharpe_ratio, snapshot.max_drawdown,
    snapshot.spy_daily_pct, snapshot.alpha
  ).run();
}

export async function getSnapshots(db, agentId, days = 30) {
  const { results } = await db.prepare(
    'SELECT * FROM daily_snapshots WHERE agent_id = ? AND date >= date(\'now\', ? || \' days\') ORDER BY date ASC'
  ).bind(agentId, -days).all();
  return results;
}

export async function getLatestSnapshot(db, agentId) {
  return db.prepare(
    'SELECT * FROM daily_snapshots WHERE agent_id = ? ORDER BY date DESC LIMIT 1'
  ).bind(agentId).first();
}

export async function getAllSnapshotsForDate(db, date) {
  const { results } = await db.prepare(
    'SELECT * FROM daily_snapshots WHERE date = ?'
  ).bind(date).all();
  return results;
}

// ── Param Changes ──

export async function insertParamChange(db, change) {
  const id = generateId();
  await db.prepare(`
    INSERT INTO param_changes (id, agent_id, changed_by, old_params, new_params, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    id, change.agent_id, change.changed_by,
    JSON.stringify(change.old_params), JSON.stringify(change.new_params), change.reason
  ).run();
}
