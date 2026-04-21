# Stocktrade: Session Context

## What This Is

A multi-agent paper trading system running as a single Cloudflare Worker. 30 AI-driven trading agents (6 strategies x 5 personalities) make swing trades (1-14 day holds) against the Alpaca Markets paper trading API, with weekly LLM-powered strategy tuning via Workers AI (Llama 3.1 70B).

## Timeline

- **~March 12, 2026** — System deployed, D1 seeded with 30 agents, first daily snapshots recorded.
- **April 7, 2026** — Initial git commit (single "initial commit").
- **April 21, 2026** — Bug discovered and fixed. System had been running for **28 trading days with zero trades** due to a data fetching bug. First 17 trades placed after the fix.

## The Bug (April 21, 2026)

The system ran for 28 days producing daily email reports of nothing. Every agent evaluated every stock every day and placed zero trades. The root cause was **not** the entry thresholds — it was a missing `start` parameter in the Alpaca historical bars API call.

### Root Cause: `alpaca.js` — `getMultiBars()`

The Alpaca `/v2/stocks/bars` endpoint defaults `start` to "the beginning of the current day" when omitted. The original code never passed a `start` date, so every call returned **1 bar per symbol** (just today's bar). All indicator calculations require a minimum of 20 bars, so every symbol was silently skipped as "insufficient data."

Additionally, the Alpaca `limit` parameter applies to the **total number of bars across all symbols**, not per-symbol. With 36 symbols sharing `limit=80`, even with proper date ranges, most symbols would be starved.

### What Was Fixed

| File | Change | Why |
|---|---|---|
| `worker/src/alpaca.js` | Auto-compute `start` date ~144 calendar days back; batch symbols in groups of 5; paginate with `next_page_token` | Without `start`, Alpaca returns only today's bar. With 36 symbols sharing one `limit`, pagination is required. |
| `worker/src/strategies.js` | Momentum: lowered multiplier from `0.05` to `0.02`, relaxed 5-day trend from `> 0` to `> -0.005` | Secondary issue — thresholds were also too tight |
| `worker/src/strategies.js` | Mean reversion: raised default `entry_rsi` from 30 to 40 | RSI below 30 rarely reached by large-cap stocks |
| `worker/src/strategies.js` | Volatility breakout: accept prices "near" upper BB (within 0.5 std), lower default `volume_threshold` from 1.5 to 1.2 | Original required price *above* upper BB + 1.5x volume simultaneously |
| `worker/src/strategies.js` | Value: added price-based fallback (52-week low proximity + RSI recovery) when KV fundamental data is missing | KV was never populated with fundamental data, so 5 agents could never trade |
| `worker/src/orchestrator.js` | Added `GET /debug/signals` endpoint for dry-run signal evaluation | Diagnostic tool — returns indicator values and signal results without placing trades |
| `worker/src/index.js` | Wired up `/debug/signals` route | Routes to new debug function |
| `worker/seed.sql` | Updated momentum `entry_threshold` (0.40-0.65), mean reversion `entry_rsi` (35-42), volbreak `volume_threshold` (1.1-1.5) | Keep seed file in sync with live DB params |

### Live DB Changes

Updated params for 15 agents (5 momentum, 5 mean reversion, 5 volatility breakout) directly in D1 via `wrangler d1 execute`. Trend following, sector rotation, and value agent params were unchanged (their fixes were code-side).

## Architecture

| Layer | Resource | Purpose |
|---|---|---|
| Infra (Terraform) | D1 database | Trade ledger, snapshots, agent state, param audit trail |
| | KV namespace | Cached fundamental data, agent config overrides |
| | R2 bucket | Archived HTML daily reports + JSON weekly review logs |
| Runtime (Wrangler) | Worker | Single worker, 5 cron triggers, HTTP API |
| | Workers AI | `@cf/meta/llama-3.1-70b-instruct` for weekly review |
| | Email Routing | Daily report to `michael.zemel@gmail.com` |
| External | Alpaca Markets | Paper trade execution, market data, historical bars |

## The 30 Agents

**6 Strategies:** Momentum, Mean Reversion, Trend Following, Volatility Breakout, Sector Rotation, Value

**5 Personalities each:** Aggressive, Conservative, Fast, Slow, Balanced — varying position size, stop-loss, and hold period.

## Cron Schedule

| Cron (UTC) | Purpose |
|---|---|
| `35 13 * * 1-5` | Market open (EDT) |
| `35 14 * * 1-5` | Market open (EST) |
| `5 20 * * 1-5` | Market close + daily report (EDT) |
| `5 21 * * 1-5` | Market close + daily report (EST) |
| `0 1 * * 1` | Weekly LLM review (Sun 8PM ET) |

## HTTP API

All endpoints require `X-Auth-Key` header.

| Endpoint | Purpose |
|---|---|
| `GET /status` | Agent counts, today's P&L, open trades |
| `GET /agents` | All 30 agents with params |
| `GET /agent/:id` | Detailed view: config, trades, 30-day snapshots |
| `GET /debug/signals` | Dry-run signal evaluation — shows indicator values and signal results without trading |
| `POST /trigger/open` | Manual market open |
| `POST /trigger/close` | Manual market close + email |
| `POST /trigger/review` | Manual weekly review |
| `POST /agent/:id/unpause` | Reactivate paused agent |

## Known Limitations

- **Value strategy** still benefits from populating KV with fundamental data (P/E, dividend yield). The price-based fallback works but is less precise.
- **Stop-loss timing** — may fail if buy hasn't filled yet.
- **Long-only** — no short selling implemented.
- **No backtesting** mode.
- **No inter-agent correlation** monitoring — all 30 agents trade independently.
- **Weekly LLM review** has had no real data to work with until now. First meaningful review will run on the next Sunday after trades accumulate.

## Deployment

```bash
cd worker && npx wrangler deploy
```

Worker URL: `https://stocktrade.michael-zemel.workers.dev`
