const TOKEN_PRICE_API_BASE_URL = "https://api.coingecko.com/api/v3/";
const BINANCE_PRICE_API_BASE_URL = "https://api.binance.com/api/v3/";
const BINANCE_SYMBOLS = Object.freeze({
  WBTC: "BTCUSDT",
  WETH: "ETHUSDT",
  SAND: "SANDUSDT",
  POL: "POLUSDT"
});

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

export class AssetPriceClient {
  constructor({ timeoutMs, cacheMs, fetchImpl = fetch }) {
    this.timeoutMs = timeoutMs;
    this.cacheMs = cacheMs;
    this.fetchImpl = fetchImpl;
    this.cache = new Map();
  }

  getCached(key) {
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    if (Date.now() - cached.fetchedAt > this.cacheMs) {
      return null;
    }

    return cached.value;
  }

  getStaleCached(key) {
    return this.cache.get(key)?.value ?? null;
  }

  setCached(key, value) {
    this.cache.set(key, {
      value,
      fetchedAt: Date.now()
    });
    return value;
  }

  async getUsdPrice(asset) {
    const cacheKey = `${asset.symbol}:${asset.address.toLowerCase()}`;
    const cached = this.getCached(cacheKey);

    if (cached !== null) {
      return cached;
    }

    if (asset.priceKind === "stable") {
      return this.setCached(cacheKey, 1);
    }

    if (asset.priceKind === "native") {
      try {
        const url = new URL("ticker/price", BINANCE_PRICE_API_BASE_URL);
        url.searchParams.set("symbol", BINANCE_SYMBOLS[asset.symbol]);
        const data = await fetchJson(url, this.timeoutMs, this.fetchImpl);
        const price = Number(data?.price);

        if (typeof price !== "number" || !Number.isFinite(price)) {
          throw new Error(`Failed to fetch USD price for ${asset.symbol}.`);
        }

        return this.setCached(cacheKey, price);
      } catch (error) {
        const staleCached = this.getStaleCached(cacheKey);

        if (staleCached !== null) {
          return staleCached;
        }

        throw error;
      }
    }

    try {
      let price;

      if (BINANCE_SYMBOLS[asset.symbol]) {
        const url = new URL("ticker/price", BINANCE_PRICE_API_BASE_URL);
        url.searchParams.set("symbol", BINANCE_SYMBOLS[asset.symbol]);
        const data = await fetchJson(url, this.timeoutMs, this.fetchImpl);
        price = Number(data?.price);
      } else {
        const url = new URL("simple/token_price/polygon-pos", TOKEN_PRICE_API_BASE_URL);
        url.searchParams.set("contract_addresses", asset.address);
        url.searchParams.set("vs_currencies", "usd");
        const data = await fetchJson(url, this.timeoutMs, this.fetchImpl);
        const row = data?.[asset.address.toLowerCase()];
        price = row?.usd;
      }

      if (typeof price !== "number" || !Number.isFinite(price)) {
        throw new Error(`Failed to fetch USD price for ${asset.symbol}.`);
      }

      return this.setCached(cacheKey, price);
    } catch (error) {
      const staleCached = this.getStaleCached(cacheKey);

      if (staleCached !== null) {
        return staleCached;
      }

      throw error;
    }
  }
}
