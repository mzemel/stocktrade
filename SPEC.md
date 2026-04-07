# Stocktrade: Multi-Agent Paper Trading System

## Overview

A multi-agent stock trading system running as a single Cloudflare Worker with 5 cron triggers, connected to Alpaca Markets paper trading API. 30 agents with distinct strategies and personalities make swing trades (1-14 day holds), self-evaluate daily performance, and receive weekly LLM-driven strategy tuning via Workers AI (Llama 3.1 70B).

## Architecture

### Cloudflare Resources (Deployed)

| Resource | Name/ID | Purpose |
|---|---|---|
| Worker (Paid plan) | `stocktrade` | Single worker handling all cron triggers and HTTP API |
| D1 Database | `97602d21-3ebe-4285-95c1-e004def6177d` | Trade ledger, daily snapshots, agent state, param change audit trail |
| KV Namespace | `d12503a5a14e4b3384b8e9065c76b509` | Cached fundamental data, agent config overrides |
| R2 Bucket | `stocktrade-reports` | Archived HTML daily reports and JSON weekly review logs |
| Workers AI | `@cf/meta/llama-3.1-70b-instruct` | Weekly strategy review (1 call/week) |
| Cron Triggers | 5 schedules | Market open (x2 for DST), market close (x2 for DST), weekly review |

### External Services

| Service | Purpose | Cost |
|---|---|---|
| Alpaca Markets (Paper) | Trade execution, market data, historical bars | Free |
| Cloudflare Workers AI | Weekly strategy review | Free tier |
| Cloudflare Email Routing | Daily report to michael.zemel@gmail.com via `send_email` binding | Free |

### Infrastructure Management

- **Terraform** manages: D1 database, KV namespace, R2 bucket
- **Wrangler** manages: Worker deployment, cron triggers, bindings (D1, KV, R2, AI, Email), secrets
- Connected by convention: Terraform outputs resource IDs, which are set in `wrangler.toml`

## Project Structure

```
~/dev/stocktrade/
├── SPEC.md                          # This file
├── .gitignore
├── .env                             # Secrets (gitignored) — CLOUDFLARE_API_TOKEN, ALPACA_*, ADMIN_KEY
│
├── terraform/
│   ├── providers.tf                 # Cloudflare provider v5.x, auth via CLOUDFLARE_API_TOKEN env var
│   ├── variables.tf                 # account_id variable
│   ├── main.tf                      # D1, KV, R2 resources + outputs
│   ├── terraform.tfvars             # Actual values (gitignored)
│   ├── terraform.tfvars.example     # Template
│   └── .gitignore
│
└── worker/
    ├── wrangler.toml                # Bindings, cron triggers, account_id
    ├── package.json                 # Scripts: deploy, db:init, seed
    ├── schema.sql                   # D1 schema (4 tables, 5 indexes)
    ├── seed.sql                     # 30 agent definitions with initial parameters
    └── src/
        ├── index.js                 # Entry: scheduled (cron) + fetch (HTTP API) handlers
        ├── alpaca.js                # Alpaca paper trading API client (account, orders, positions, bars, quotes)
        ├── indicators.js            # SMA, EMA, RSI, Bollinger Bands, momentum, avg volume, std dev
        ├── strategies.js            # 6 strategy entry/exit evaluators + stock universe definitions
        ├── orchestrator.js          # Market open (evaluate entries, place orders) + market close (evaluate exits, compute P&L)
        ├── report.js                # HTML email report generation + R2 archival + send via Email Routing
        ├── review.js                # Weekly LLM review: build prompt, call Workers AI, parse adjustments, apply changes
        └── db.js                    # D1 query helpers for agents, trades, snapshots, param changes
```

## Agent Design

### 30 Agents = 6 Strategies x 5 Personalities

#### Strategies

1. **Momentum** (`momentum`) — Buy stocks with strong recent price trends; entry when N-day return exceeds threshold and 5-day trend is positive
2. **Mean Reversion** (`mean_reversion`) — Buy oversold stocks expecting bounce; entry when RSI drops below threshold
3. **Trend Following** (`trend_following`) — Moving average crossover signals; entry when short MA crosses above long MA and price is above long MA
4. **Volatility Breakout** (`volatility_breakout`) — Enter on unusual price movement; entry when price breaks above upper Bollinger Band on above-average volume
5. **Sector Rotation** (`sector_rotation`) — Shift between sectors based on relative strength vs SPY; buy stocks in top-performing sectors
6. **Value** (`value`) — Simple valuation heuristics; entry on low P/E ratio combined with minimum dividend yield

#### Personalities

| Personality | Position Size | Stop-Loss | Hold Period |
|---|---|---|---|
| **Aggressive** | 15% of allocation | 2% | 2-3 days |
| **Conservative** | 8% of allocation | 5% | 7-10 days |
| **Fast** | 12% of allocation | 3% | 1-2 days |
| **Slow** | 10% of allocation | 4% | 5-10 days |
| **Balanced** | 10% of allocation | 3% | 3-5 days |

#### Agent IDs

Format: `{strategy_short}-{personality}`. Examples: `momentum-aggressive`, `meanrev-conservative`, `trend-fast`, `volbreak-slow`, `sectrot-balanced`, `value-aggressive`.

### Stock Universe (29 stocks + 7 ETFs = 36 tickers)

| Sector | Stocks | Sector ETF |
|---|---|---|
| Tech | AAPL, MSFT, GOOGL, AMZN, NVDA, META | XLK |
| Energy | XOM, CVX, COP, SLB, EOG | XLE |
| Finance | JPM, BAC, GS, MS | XLF |
| Healthcare | JNJ, UNH, PFE, ABBV, MRK | XLV |
| Consumer | WMT, PG, KO, MCD, NKE | XLP |
| Industrial | CAT, HON, UPS, GE | XLI |
| Benchmark | — | SPY |

Sector ETFs are used for relative strength calculations (sector rotation strategy) and SPY is the universal benchmark for alpha computation.

## Cron Schedule & DST Handling

The worker fires on both EST and EDT UTC offsets for market open/close. The handler checks Alpaca's `/v2/clock` API to determine if the market is actually open, handling DST transitions and market holidays automatically.

| Cron (UTC) | Covers | Purpose |
|---|---|---|
| `35 13 * * 1-5` | 9:35 AM EDT | Market open |
| `35 14 * * 1-5` | 9:35 AM EST | Market open |
| `5 20 * * 1-5` | 4:05 PM EDT | Market close + daily report |
| `5 21 * * 1-5` | 4:05 PM EST | Market close + daily report |
| `0 1 * * 1` | Sun 8 PM EST / 9 PM EDT | Weekly LLM review |

The 5-minute offset from actual open/close avoids auction volatility.

## Capital Allocation (Paper Mode)

- Starting paper balance: $100,000 (Alpaca paper default)
- Per-agent allocation: $3,000 (tracked in D1 `agents.current_balance`)
- Per-trade position: Based on personality (8-15% of allocation = $240-$450)
- Max concurrent positions per agent: 5

## Risk Management

### Per-Trade (implemented in `orchestrator.js`)

- **Hard stop-loss**: Placed as a separate GTC stop order via Alpaca immediately after buy fill (personality-dependent: 2-5%)
- **Take-profit**: Evaluated at market close; exit if current price >= entry price * (1 + take_profit_pct)
- **Max position size**: Checked against agent's available balance before order placement

### Per-Agent (implemented in `orchestrator.js`)

- **Daily loss limit**: If agent's realized P&L today < -3% of allocation, no new trades until next day
- **Max drawdown**: If portfolio value drops > 10% from `peak_balance`, agent is paused (`is_active = 0`) with reason logged

### System-Level

- **Capital isolation**: Each agent's balance tracked independently in D1; no agent can spend another's allocation
- **Order validation**: Every order passes through capital availability check before submission to Alpaca
- **No margin, no leverage**: Paper account uses cash-only ordering

## Data Model (D1)

### Tables (as deployed in `schema.sql`)

#### `agents`

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | e.g., `momentum-aggressive` |
| strategy | TEXT | `momentum`, `mean_reversion`, `trend_following`, `volatility_breakout`, `sector_rotation`, `value` |
| personality | TEXT | `aggressive`, `conservative`, `fast`, `slow`, `balanced` |
| params | TEXT (JSON) | Strategy + personality parameters (stop_loss_pct, take_profit_pct, position_size_pct, max_hold_days, plus strategy-specific) |
| allocation | REAL | Starting allocation, default 3000 |
| current_balance | REAL | Running cash balance, updated on trade close |
| peak_balance | REAL | High-water mark for drawdown calculation |
| is_active | INTEGER | 1 = active, 0 = paused |
| paused_reason | TEXT | Why agent was paused (null if active) |
| created_at, updated_at | TEXT | ISO timestamps |

#### `trades`

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| agent_id | TEXT FK | References agents.id |
| symbol | TEXT | Ticker symbol |
| side | TEXT | `buy` or `sell` |
| quantity | REAL | Share count (fractional) |
| price | REAL | Entry price |
| total_cost | REAL | Notional amount (price * quantity) |
| alpaca_order_id | TEXT | Alpaca buy order ID |
| stop_loss_order_id | TEXT | Alpaca stop-loss order ID |
| status | TEXT | `open` or `closed` |
| entry_date | TEXT | ISO date |
| exit_date, exit_price | TEXT, REAL | Filled on close |
| pnl, pnl_pct | REAL | Computed on close |
| hold_days | INTEGER | Calendar days held |
| signal_reason | TEXT | Why the agent entered (human-readable) |

#### `daily_snapshots`

One row per agent per trading day. Includes: portfolio_value, daily_pnl, daily_pnl_pct, cumulative_pnl, cumulative_pnl_pct, open_positions, trades_today, win_rate (rolling 30-day), sharpe_ratio (annualized from daily returns), max_drawdown, spy_daily_pct, alpha. Unique constraint on (agent_id, date).

#### `param_changes`

Audit trail for every parameter modification. Records agent_id, changed_by (`weekly_review` or `manual`), old_params (full JSON), new_params (full JSON), and reason (LLM-generated explanation for weekly review changes).

### Indexes

- `idx_trades_agent_id`, `idx_trades_status`, `idx_trades_entry_date`
- `idx_snapshots_agent_date`, `idx_snapshots_date`

## Strategy Signal Definitions (as implemented in `strategies.js`)

### Momentum

- **Entry**: N-day momentum > 5% * threshold AND 5-day momentum > 0
- **Exit**: 20-day momentum turns negative
- **Tunable params**: `lookback_days` (10/20/30), `entry_threshold` (0.70-0.80)

### Mean Reversion

- **Entry**: RSI(N) < entry_rsi threshold
- **Exit**: RSI(N) > exit_rsi threshold
- **Tunable params**: `rsi_period` (7/14/21), `entry_rsi` (25-30), `exit_rsi` (45-55)

### Trend Following

- **Entry**: SMA(short) > SMA(long) AND price > SMA(long)
- **Exit**: SMA(short) < SMA(long)
- **Tunable params**: `short_ma` (5-20), `long_ma` (15-60)

### Volatility Breakout

- **Entry**: Price > upper Bollinger Band AND volume > N * average volume
- **Exit**: Price < Bollinger Band middle line
- **Tunable params**: `bb_period` (10/20/30), `bb_std` (1.5-2.5), `volume_threshold` (1.3-2.0x)

### Sector Rotation

- **Entry**: Symbol's sector is in top N sectors by relative strength vs SPY (measured by sector ETF momentum)
- **Exit**: Hold period only (no strategy-specific exit signal)
- **Tunable params**: `rotation_lookback` (5-30), `top_n_sectors` (1-3)

### Value

- **Entry**: P/E ratio < 20 AND P/E > 0 AND dividend yield > min_dividend_yield (requires fundamental data cached in KV)
- **Exit**: Hold period only (no strategy-specific exit signal)
- **Tunable params**: `pe_threshold_pctile` (0.20-0.30), `min_dividend_yield` (0.01-0.025)
- **Note**: Value strategy depends on fundamental data in KV (`fundamentals` key). This must be populated separately; without it, value agents will not trigger entries.

### Universal Exit Conditions (all strategies)

In addition to strategy-specific exits, all agents exit when:
1. **Max hold period** exceeded (`max_hold_days` param)
2. **Take-profit** hit (current price >= entry * (1 + `take_profit_pct`))
3. **Hard stop-loss** triggered by Alpaca stop order (placed at entry)

## Daily Report

- **Format**: HTML email via Cloudflare Email Routing `send_email` binding
- **From**: `stocktrade@thebackend.dev`
- **To**: `michael.zemel@gmail.com`
- **Subject**: `Stocktrade {date}: +$X.XX` or `Stocktrade {date}: -$X.XX`
- **Content**:
  - Portfolio summary: total value, daily P&L ($ and %), cumulative P&L, active agent count
  - Top 3 performers and bottom 3 performers by daily P&L
  - Full agent table: name, daily P&L, cumulative P&L, open positions, win rate, Sharpe, alpha vs SPY
  - Paused agent alerts (if any exceeded 10% drawdown)
- **Archive**: Every report also stored in R2 at `reports/{date}.html`

### Email Routing Prerequisite

Email sending requires:
1. Email Routing enabled on `thebackend.dev` in Cloudflare dashboard
2. `michael.zemel@gmail.com` verified as a destination address
3. Without this, reports are still archived in R2 — only email delivery fails

## Weekly Review (LLM)

- **When**: Monday 01:00 UTC (Sunday 8 PM EST)
- **Model**: `@cf/meta/llama-3.1-70b-instruct` via Workers AI
- **Process**:
  1. Aggregate 7-day performance for all 30 agents (including paused ones)
  2. Compute per-agent: weekly P&L, avg daily P&L %, avg alpha, win rate, Sharpe, max drawdown
  3. Include SPY weekly return as market context
  4. Send structured prompt to LLM with all agent summaries and current parameters
  5. LLM returns per-agent assessments and parameter adjustment suggestions in `<adjustments>` JSON block
  6. Parse suggestions; each has a confidence level (high/medium/low)
  7. **Auto-apply**: Only high-confidence suggestions (after parameter validation)
  8. **Log only**: Medium and low confidence suggestions logged but not applied
  9. All changes recorded in `param_changes` table with LLM-generated reasoning
- **Validation bounds**: stop_loss 0.5-15%, take_profit 1-30%, position_size 3-25%, max_hold 1-30 days, entry_rsi 10-50, exit_rsi 30-80
- **Archive**: Full review (summaries, LLM response, parsed adjustments) stored in R2 at `reviews/{date}.json`

## HTTP API

The worker exposes an HTTP API at `https://stocktrade.michael-zemel.workers.dev` for manual intervention. All endpoints require `X-Auth-Key` header matching the `ADMIN_KEY` secret.

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | Overview: agent counts, today's P&L, open trade count |
| GET | `/agents` | List all 30 agents with current params and state |
| GET | `/agent/:id` | Detailed agent view: config, open trades, recent closed trades, 30-day snapshots |
| POST | `/trigger/open` | Manually trigger market open logic |
| POST | `/trigger/close` | Manually trigger market close + email report |
| POST | `/trigger/review` | Manually trigger weekly LLM review |
| POST | `/agent/:id/unpause` | Reactivate a paused agent |

## Secrets (set via `wrangler secret put`)

| Secret | Purpose |
|---|---|
| `ALPACA_API_KEY` | Alpaca paper trading API key ID |
| `ALPACA_SECRET_KEY` | Alpaca paper trading secret key |
| `ADMIN_KEY` | Auth key for the HTTP API (random 32-byte hex) |

## Setup / Redeployment

```bash
# 1. Terraform (one-time infra setup)
cd ~/dev/stocktrade/terraform
source ../dev/stocktrade/.env  # needs CLOUDFLARE_API_TOKEN
terraform init
terraform apply

# 2. Update wrangler.toml with Terraform output IDs
# d1_databases.database_id and kv_namespaces.id

# 3. Install deps and deploy worker
cd ~/dev/stocktrade/worker
npm install
npx wrangler deploy

# 4. Initialize database
npm run db:init      # Creates tables
npm run seed         # Seeds 30 agents

# 5. Set secrets
echo "$ALPACA_API_KEY" | npx wrangler secret put ALPACA_API_KEY
echo "$ALPACA_SECRET_KEY" | npx wrangler secret put ALPACA_SECRET_KEY
echo "$(openssl rand -hex 32)" | npx wrangler secret put ADMIN_KEY
```

## Known Limitations / Future Work

- **Value strategy**: Requires fundamental data (P/E, dividend yield) to be populated in KV under the `fundamentals` key. No automated feed exists yet — this data must be populated manually or via a separate data pipeline.
- **Stop-loss timing**: The stop-loss order is placed immediately after the buy, but may fail if the buy hasn't filled yet. The system logs the failure; unfilled stop-losses should be caught at next market close evaluation.
- **No short selling**: All agents are long-only. The Alpaca paper API supports shorting, but the current strategy implementations only generate buy signals.
- **Backtesting**: The system runs live against the paper trading API. A historical backtesting mode (using Alpaca's historical bars API against past data) would significantly accelerate strategy validation but is not yet implemented.
- **Correlation monitoring**: The SPEC envisions inter-agent correlation analysis, but this is not yet implemented. All agents operate independently without awareness of each other's positions.
