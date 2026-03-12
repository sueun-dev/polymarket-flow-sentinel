function buildUrl(baseUrl, pathname, query = {}) {
  const url = new URL(pathname, baseUrl);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url;
}

async function fetchJson(url, timeoutMs, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "polymarket-flow-sentinel/1.0.0"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeWallet(wallet) {
  return (wallet ?? "").toLowerCase();
}

export function getTradeUsdSize(trade) {
  if (typeof trade?.usdcSize === "number" && Number.isFinite(trade.usdcSize)) {
    return trade.usdcSize;
  }

  if (
    typeof trade?.size === "number" &&
    Number.isFinite(trade.size) &&
    typeof trade?.price === "number" &&
    Number.isFinite(trade.price)
  ) {
    return trade.size * trade.price;
  }

  return 0;
}

export class PolymarketDataClient {
  constructor({
    baseUrl,
    timeoutMs,
    activityPageSize,
    activityPageCount,
    fetchImpl = fetch
  }) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.activityPageSize = Math.min(activityPageSize, 500);
    this.activityPageCount = activityPageCount;
    this.fetchImpl = fetchImpl;
  }

  async getActivity({
    user,
    type,
    limit = this.activityPageSize,
    offset = 0,
    start,
    end,
    sortDirection = "DESC"
  }) {
    const url = buildUrl(this.baseUrl, "/activity", {
      user,
      type,
      limit: Math.min(limit, 500),
      offset,
      start,
      end,
      sortDirection
    });
    const data = await fetchJson(url, this.timeoutMs, this.fetchImpl);

    if (!Array.isArray(data)) {
      throw new Error(`Unexpected response from /activity for wallet ${user}.`);
    }

    return data;
  }

  async getFirstActivity(wallet) {
    const rows = await this.getActivity({
      user: wallet,
      limit: 1,
      sortDirection: "ASC"
    });

    return rows[0] ?? null;
  }

  async getFirstTrade(wallet) {
    const rows = await this.getActivity({
      user: wallet,
      type: "TRADE",
      limit: 1,
      sortDirection: "ASC"
    });

    return rows[0] ?? null;
  }

  async getTradeActivitySince(wallet, startTimestamp) {
    const rows = [];

    for (let page = 0; page < this.activityPageCount; page += 1) {
      const offset = page * this.activityPageSize;
      const pageRows = await this.getActivity({
        user: wallet,
        type: "TRADE",
        start: startTimestamp,
        limit: this.activityPageSize,
        offset,
        sortDirection: "ASC"
      });

      rows.push(...pageRows);

      if (pageRows.length < this.activityPageSize) {
        break;
      }
    }

    return rows;
  }
}
