// Alpaca Markets API client for paper trading
// Docs: https://docs.alpaca.markets/reference

const PAPER_BASE = 'https://paper-api.alpaca.markets';
const DATA_BASE = 'https://data.alpaca.markets';

export class AlpacaClient {
  constructor(apiKey, secretKey) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.headers = {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': secretKey,
      'Content-Type': 'application/json',
    };
  }

  async request(base, path, options = {}) {
    const { method = 'GET', body, params } = options;
    let url = `${base}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url += `?${qs}`;
    }
    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Alpaca ${method} ${path}: ${res.status} ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // ── Account ──

  async getAccount() {
    return this.request(PAPER_BASE, '/v2/account');
  }

  // ── Market Clock ──

  async getClock() {
    return this.request(PAPER_BASE, '/v2/clock');
  }

  async isMarketOpen() {
    const clock = await this.getClock();
    return clock.is_open;
  }

  // ── Orders ──

  async placeOrder({ symbol, qty, side, type = 'market', time_in_force = 'day', stop_price, limit_price, order_class, take_profit, stop_loss }) {
    const body = { symbol, qty: String(qty), side, type, time_in_force };
    if (stop_price) body.stop_price = String(stop_price);
    if (limit_price) body.limit_price = String(limit_price);
    if (order_class) body.order_class = order_class;
    if (take_profit) body.take_profit = take_profit;
    if (stop_loss) body.stop_loss = stop_loss;
    return this.request(PAPER_BASE, '/v2/orders', { method: 'POST', body });
  }

  // Place a bracket order: market buy + stop-loss + take-profit
  async placeBracketOrder(symbol, qty, stopLossPct, takeProfitPct) {
    return this.placeOrder({
      symbol,
      qty,
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
      order_class: 'bracket',
      take_profit: { limit_price: null }, // Set after fill via replace
      stop_loss: { stop_price: null },    // Set after fill via replace
    });
  }

  // Simpler approach: market buy, then separate stop-loss order
  async buyWithStopLoss(symbol, notional, stopLossPct) {
    // Buy fractional shares by notional amount
    const buyOrder = await this.request(PAPER_BASE, '/v2/orders', {
      method: 'POST',
      body: {
        symbol,
        notional: String(notional.toFixed(2)),
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
      },
    });
    return buyOrder;
  }

  async placeStopLoss(symbol, qty, stopPrice) {
    return this.request(PAPER_BASE, '/v2/orders', {
      method: 'POST',
      body: {
        symbol,
        qty: String(qty),
        side: 'sell',
        type: 'stop',
        stop_price: String(stopPrice.toFixed(2)),
        time_in_force: 'gtc',
      },
    });
  }

  async placeSellOrder(symbol, qty) {
    return this.request(PAPER_BASE, '/v2/orders', {
      method: 'POST',
      body: {
        symbol,
        qty: String(qty),
        side: 'sell',
        type: 'market',
        time_in_force: 'day',
      },
    });
  }

  async cancelOrder(orderId) {
    return this.request(PAPER_BASE, `/v2/orders/${orderId}`, { method: 'DELETE' });
  }

  async listOrders(params = {}) {
    return this.request(PAPER_BASE, '/v2/orders', { params: { status: 'open', ...params } });
  }

  async getOrder(orderId) {
    return this.request(PAPER_BASE, `/v2/orders/${orderId}`);
  }

  // ── Positions ──

  async listPositions() {
    return this.request(PAPER_BASE, '/v2/positions');
  }

  async getPosition(symbol) {
    try {
      return await this.request(PAPER_BASE, `/v2/positions/${symbol}`);
    } catch (e) {
      if (e.message.includes('404')) return null;
      throw e;
    }
  }

  async closePosition(symbol) {
    return this.request(PAPER_BASE, `/v2/positions/${symbol}`, { method: 'DELETE' });
  }

  // ── Market Data ──

  // Get historical bars for multiple symbols
  // timeframe: '1Day', '1Hour', etc.
  // Returns { bars: { AAPL: [...], MSFT: [...] } }
  //
  // NOTE: Alpaca's limit is TOTAL across all symbols, not per-symbol.
  // With 36 symbols and limit=80, you'd get ~2 bars per symbol.
  // We fetch in small batches to ensure each symbol gets enough bars.
  async getMultiBars(symbols, { timeframe = '1Day', start, end, limit = 80 } = {}) {
    // Default start to ~120 calendar days ago to ensure enough trading days
    // Alpaca defaults to "beginning of current day" if start is omitted,
    // which returns only 1 bar — not enough for any indicator calculation.
    if (!start) {
      const d = new Date();
      d.setDate(d.getDate() - Math.ceil(limit * 1.8)); // ~1.8x for weekends/holidays
      start = d.toISOString().split('T')[0];
    }

    const allBars = {};
    // Batch into groups of 5 symbols so each gets enough bars within the limit
    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      let pageToken = null;
      // Paginate to collect all bars for this batch
      do {
        const params = {
          symbols: batch.join(','),
          timeframe,
          start,
          limit: String(limit * batch.length),
        };
        if (end) params.end = end;
        if (pageToken) params.page_token = pageToken;
        const resp = await this.request(DATA_BASE, '/v2/stocks/bars', { params });
        const bars = resp.bars || {};
        for (const [symbol, symbolBars] of Object.entries(bars)) {
          if (!allBars[symbol]) allBars[symbol] = [];
          allBars[symbol].push(...symbolBars);
        }
        pageToken = resp.next_page_token || null;
      } while (pageToken);
    }
    return { bars: allBars };
  }

  // Get latest quotes for multiple symbols
  async getLatestQuotes(symbols) {
    return this.request(DATA_BASE, '/v2/stocks/quotes/latest', {
      params: { symbols: symbols.join(',') },
    });
  }

  // Get latest trades for multiple symbols
  async getLatestTrades(symbols) {
    return this.request(DATA_BASE, '/v2/stocks/trades/latest', {
      params: { symbols: symbols.join(',') },
    });
  }

  // Get snapshot (latest trade, quote, minute/daily bar) for multiple symbols
  async getSnapshots(symbols) {
    return this.request(DATA_BASE, '/v2/stocks/snapshots', {
      params: { symbols: symbols.join(',') },
    });
  }
}
