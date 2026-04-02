import {
  isRecord,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  readString
} from "./runtime-guards.js";

import type { ActivityQuery, FetchLike, PolymarketActivityRow } from "./types.js";

const GAMMA_API_BASE_URL = "https://gamma-api.polymarket.com";
interface PolymarketDataClientOptions {
  baseUrl: string;
  timeoutMs: number;
  activityPageSize: number;
  activityPageCount: number;
  fetchImpl?: FetchLike;
}

function buildUrl(
  baseUrl: string,
  pathname: string,
  query: Record<string, string | number | undefined>
): URL {
  const url = new URL(pathname, baseUrl);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url;
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

async function fetchOptionalJson(
  url: URL,
  timeoutMs: number,
  fetchImpl: FetchLike
): Promise<unknown | null> {
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

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url.toString()}`);
    }

    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function parseActivityRow(value: unknown, index: number): PolymarketActivityRow {
  if (!isRecord(value)) {
    throw new Error(`Polymarket activity row ${index} must be an object.`);
  }

  const row: PolymarketActivityRow = {
    transactionHash: readString(value["transactionHash"], `activity[${index}].transactionHash`),
    timestamp: readNumber(value["timestamp"], `activity[${index}].timestamp`)
  };

  const title = readOptionalString(value["title"], `activity[${index}].title`);
  const outcome = readOptionalString(value["outcome"], `activity[${index}].outcome`);
  const side = readOptionalString(value["side"], `activity[${index}].side`);
  const slug = readOptionalString(value["slug"], `activity[${index}].slug`);
  const usdcSize = readOptionalNumber(value["usdcSize"], `activity[${index}].usdcSize`);
  const size = readOptionalNumber(value["size"], `activity[${index}].size`);
  const price = readOptionalNumber(value["price"], `activity[${index}].price`);
  const type = readOptionalString(value["type"], `activity[${index}].type`);
  const proxyWallet = readOptionalString(value["proxyWallet"], `activity[${index}].proxyWallet`);

  if (title !== undefined) {
    row.title = title;
  }
  if (outcome !== undefined) {
    row.outcome = outcome;
  }
  if (side !== undefined) {
    row.side = side;
  }
  if (slug !== undefined) {
    row.slug = slug;
  }
  if (usdcSize !== undefined) {
    row.usdcSize = usdcSize;
  }
  if (size !== undefined) {
    row.size = size;
  }
  if (price !== undefined) {
    row.price = price;
  }
  if (type !== undefined) {
    row.type = type;
  }
  if (proxyWallet !== undefined) {
    row.proxyWallet = proxyWallet;
  }

  return row;
}

export function normalizeWallet(wallet: string | null | undefined): string {
  return (wallet ?? "").toLowerCase();
}

export function getTradeUsdSize(
  trade: Pick<PolymarketActivityRow, "usdcSize" | "size" | "price">
): number {
  if (typeof trade.usdcSize === "number" && Number.isFinite(trade.usdcSize)) {
    return trade.usdcSize;
  }

  if (
    typeof trade.size === "number" &&
    Number.isFinite(trade.size) &&
    typeof trade.price === "number" &&
    Number.isFinite(trade.price)
  ) {
    return trade.size * trade.price;
  }

  return 0;
}

export class PolymarketDataClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly activityPageSize: number;
  private readonly activityPageCount: number;
  private readonly fetchImpl: FetchLike;
  private readonly profileWalletCache = new Map<string, string | null>();

  constructor({
    baseUrl,
    timeoutMs,
    activityPageSize,
    activityPageCount,
    fetchImpl = fetch
  }: PolymarketDataClientOptions) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.activityPageSize = Math.min(activityPageSize, 500);
    this.activityPageCount = activityPageCount;
    this.fetchImpl = fetchImpl;
  }

  async getCanonicalProfileWallet(wallet: string): Promise<string | null> {
    const normalizedWallet = normalizeWallet(wallet);
    const cached = this.profileWalletCache.get(normalizedWallet);

    if (cached !== undefined) {
      return cached;
    }

    const url = buildUrl(GAMMA_API_BASE_URL, "/public-profile", {
      address: normalizedWallet
    });
    const payload = await fetchOptionalJson(url, this.timeoutMs, this.fetchImpl);

    if (!isRecord(payload)) {
      this.profileWalletCache.set(normalizedWallet, null);
      return null;
    }

    const proxyWallet = normalizeWallet(
      readOptionalString(payload["proxyWallet"], "publicProfile.proxyWallet")
    );
    const canonicalWallet = proxyWallet || null;
    this.profileWalletCache.set(normalizedWallet, canonicalWallet);
    if (canonicalWallet) {
      this.profileWalletCache.set(canonicalWallet, canonicalWallet);
    }
    return canonicalWallet;
  }

  async getActivity({
    user,
    type,
    limit = this.activityPageSize,
    offset = 0,
    start,
    end,
    sortDirection = "DESC"
  }: ActivityQuery): Promise<PolymarketActivityRow[]> {
    const url = buildUrl(this.baseUrl, "/activity", {
      user,
      type,
      limit: Math.min(limit, 500),
      offset,
      start,
      end,
      sortDirection
    });
    const payload = await fetchJson(url, this.timeoutMs, this.fetchImpl);

    if (!Array.isArray(payload)) {
      throw new Error(`Unexpected response from /activity for wallet ${user}.`);
    }

    return payload.map((row, index) => parseActivityRow(row, index));
  }

  async getFirstActivity(wallet: string): Promise<PolymarketActivityRow | null> {
    const rows = await this.getActivity({
      user: wallet,
      limit: 1,
      sortDirection: "ASC"
    });

    return rows[0] ?? null;
  }

  async getFirstTrade(wallet: string): Promise<PolymarketActivityRow | null> {
    const rows = await this.getActivity({
      user: wallet,
      type: "TRADE",
      limit: 1,
      sortDirection: "ASC"
    });

    return rows[0] ?? null;
  }

  async getTradeActivitySince(
    wallet: string,
    startTimestamp: number
  ): Promise<PolymarketActivityRow[]> {
    const rows: PolymarketActivityRow[] = [];

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
