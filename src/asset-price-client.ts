import { isRecord, readNumber, readString } from "./runtime-guards.js";

import type { FetchLike, PolygonFundingAsset } from "./types.js";

const TOKEN_PRICE_API_BASE_URL = "https://api.coingecko.com/api/v3/";
const BINANCE_PRICE_API_BASE_URL = "https://api.binance.com/api/v3/";
const BINANCE_SYMBOLS = Object.freeze({
  WBTC: "BTCUSDT",
  WETH: "ETHUSDT",
  SAND: "SANDUSDT",
  POL: "POLUSDT"
} as const);

type BinanceTrackedSymbol = keyof typeof BINANCE_SYMBOLS;

interface CachedValue {
  value: number;
  fetchedAt: number;
}

interface AssetPriceClientOptions {
  timeoutMs: number;
  cacheMs: number;
  fetchImpl?: FetchLike;
}

function isBinanceTrackedSymbol(symbol: string): symbol is BinanceTrackedSymbol {
  return Object.hasOwn(BINANCE_SYMBOLS, symbol);
}

async function fetchJson(url: URL, timeoutMs: number, fetchImpl: FetchLike): Promise<unknown> {
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
      throw new Error(`HTTP ${response.status} for ${url.toString()}`);
    }

    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function parseBinanceTickerPrice(payload: unknown): number {
  if (!isRecord(payload)) {
    throw new Error("Binance ticker response must be an object.");
  }

  const rawPrice = readString(payload["price"], "Binance ticker price");
  const price = Number(rawPrice);

  return readNumber(price, "Binance ticker price");
}

function parseCoinGeckoTokenPrice(payload: unknown, assetAddress: string): number {
  if (!isRecord(payload)) {
    throw new Error("CoinGecko token price response must be an object.");
  }

  const assetEntry = payload[assetAddress.toLowerCase()];
  if (!isRecord(assetEntry)) {
    throw new Error(`CoinGecko token price response missing entry for ${assetAddress}.`);
  }

  return readNumber(assetEntry["usd"], `CoinGecko USD price for ${assetAddress}`);
}

export class AssetPriceClient {
  private readonly timeoutMs: number;
  private readonly cacheMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly cache = new Map<string, CachedValue>();

  constructor({ timeoutMs, cacheMs, fetchImpl = fetch }: AssetPriceClientOptions) {
    this.timeoutMs = timeoutMs;
    this.cacheMs = cacheMs;
    this.fetchImpl = fetchImpl;
  }

  private getCached(key: string): number | null {
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    if (Date.now() - cached.fetchedAt > this.cacheMs) {
      return null;
    }

    return cached.value;
  }

  private getStaleCached(key: string): number | null {
    return this.cache.get(key)?.value ?? null;
  }

  private setCached(key: string, value: number): number {
    this.cache.set(key, {
      value,
      fetchedAt: Date.now()
    });
    return value;
  }

  private async fetchBinanceUsdPrice(symbol: BinanceTrackedSymbol): Promise<number> {
    const url = new URL("ticker/price", BINANCE_PRICE_API_BASE_URL);
    url.searchParams.set("symbol", BINANCE_SYMBOLS[symbol]);
    const payload = await fetchJson(url, this.timeoutMs, this.fetchImpl);
    return parseBinanceTickerPrice(payload);
  }

  async getUsdPrice(asset: PolygonFundingAsset): Promise<number> {
    const cacheKey = `${asset.symbol}:${asset.address.toLowerCase()}`;
    const cached = this.getCached(cacheKey);

    if (cached !== null) {
      return cached;
    }

    if (asset.priceKind === "stable") {
      return this.setCached(cacheKey, 1);
    }

    if (isBinanceTrackedSymbol(asset.symbol)) {
      try {
        return this.setCached(cacheKey, await this.fetchBinanceUsdPrice(asset.symbol));
      } catch (error: unknown) {
        const staleCached = this.getStaleCached(cacheKey);

        if (staleCached !== null) {
          return staleCached;
        }

        throw error;
      }
    }

    try {
      const url = new URL("simple/token_price/polygon-pos", TOKEN_PRICE_API_BASE_URL);
      url.searchParams.set("contract_addresses", asset.address);
      url.searchParams.set("vs_currencies", "usd");
      const payload = await fetchJson(url, this.timeoutMs, this.fetchImpl);
      const price = parseCoinGeckoTokenPrice(payload, asset.address);
      return this.setCached(cacheKey, price);
    } catch (error: unknown) {
      const staleCached = this.getStaleCached(cacheKey);

      if (staleCached !== null) {
        return staleCached;
      }

      throw error;
    }
  }
}
