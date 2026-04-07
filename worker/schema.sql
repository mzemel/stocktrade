-- Stocktrade D1 Schema

-- Agent definitions and current parameters
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  strategy TEXT NOT NULL,
  personality TEXT NOT NULL,
  params TEXT NOT NULL,
  allocation REAL NOT NULL DEFAULT 3000,
  current_balance REAL NOT NULL DEFAULT 3000,
  peak_balance REAL NOT NULL DEFAULT 3000,
  is_active INTEGER NOT NULL DEFAULT 1,
  paused_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Individual trades
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  total_cost REAL NOT NULL,
  alpaca_order_id TEXT,
  stop_loss_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  entry_date TEXT NOT NULL,
  exit_date TEXT,
  exit_price REAL,
  pnl REAL,
  pnl_pct REAL,
  hold_days INTEGER,
  signal_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Daily snapshots per agent
CREATE TABLE IF NOT EXISTS daily_snapshots (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  date TEXT NOT NULL,
  portfolio_value REAL NOT NULL,
  daily_pnl REAL NOT NULL,
  daily_pnl_pct REAL NOT NULL,
  cumulative_pnl REAL NOT NULL,
  cumulative_pnl_pct REAL NOT NULL,
  open_positions INTEGER NOT NULL DEFAULT 0,
  trades_today INTEGER NOT NULL DEFAULT 0,
  win_rate REAL,
  sharpe_ratio REAL,
  max_drawdown REAL,
  spy_daily_pct REAL,
  alpha REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  UNIQUE(agent_id, date)
);

-- Parameter change audit trail
CREATE TABLE IF NOT EXISTS param_changes (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  changed_by TEXT NOT NULL,
  old_params TEXT NOT NULL,
  new_params TEXT NOT NULL,
  reason TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_trades_agent_id ON trades(agent_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_entry_date ON trades(entry_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_agent_date ON daily_snapshots(agent_id, date);
CREATE INDEX IF NOT EXISTS idx_snapshots_date ON daily_snapshots(date);
