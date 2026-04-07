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
  // Returns { bars: { AAPL: [...], MSFT: [...] }, next_page_token }
  async getMultiBars(symbols, { timeframe = '1Day', start, end, limit = 60 } = {}) {
    const params = {
      symbols: symbols.join(','),
      timeframe,
      limit: String(limit),
    };
    if (start) params.start = start;
    if (end) params.end = end;
    return this.request(DATA_BASE, '/v2/stocks/bars', { params });
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
