import path from "node:path";

import type { BootstrapMode, MonitorConfig } from "./types.js";

const DEFAULTS: Omit<MonitorConfig, "once"> = {
  dataApiBaseUrl: "https://data-api.polymarket.com",
  polygonRpcUrl: "https://polygon.drpc.org",
  minFundingUsd: 50_000,
  minDepositUsd: 10_000,
  minTradeUsd: 0,
  pollIntervalMs: 5_000,
  startupLookbackBlocks: 256,
  blockBatchSize: 20,
  activityPageSize: 500,
  activityPageCount: 10,
  priceCacheMs: 60_000,
  requestTimeoutMs: 15_000,
  maxTrackedWallets: 2_000,
  maxSeenFundingTransfers: 50_000,
  maxSentEventKeys: 20_000,
  maxRecentAlerts: 100,
  refreshConcurrency: 10,
  stateFile: path.resolve(process.cwd(), ".data/polymarket-flow-sentinel.json"),
  webhookUrl: "",
  bootstrapMode: "scan",
  host: "0.0.0.0",
  port: 3000
};

function readNumber(
  name: string,
  fallback: number,
  { allowZero = false }: { allowZero?: boolean } = {}
): number {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(
      `Environment variable ${name} must be ${allowZero ? "a non-negative" : "a positive"} number.`
    );
  }

  return value;
}

function readBootstrapMode(rawValue: string | undefined): BootstrapMode {
  const value = rawValue ?? DEFAULTS.bootstrapMode;

  if (value !== "skip" && value !== "scan") {
    throw new Error("POLYMARKET_BOOTSTRAP_MODE must be either 'skip' or 'scan'.");
  }

  return value;
}

export function loadConfig(argv: string[] = process.argv.slice(2)): MonitorConfig {
  const once = argv.includes("--once");
  const bootstrapMode = readBootstrapMode(process.env["POLYMARKET_BOOTSTRAP_MODE"]);

  return {
    once,
    dataApiBaseUrl: process.env["POLYMARKET_DATA_API_BASE_URL"] ?? DEFAULTS.dataApiBaseUrl,
    polygonRpcUrl: process.env["POLYGON_RPC_URL"] ?? DEFAULTS.polygonRpcUrl,
    minFundingUsd: readNumber("POLYMARKET_MIN_FUNDING_USD", DEFAULTS.minFundingUsd),
    minDepositUsd: readNumber("POLYMARKET_MIN_DEPOSIT_USD", DEFAULTS.minDepositUsd),
    minTradeUsd: readNumber("POLYMARKET_MIN_TRADE_USD", DEFAULTS.minTradeUsd, { allowZero: true }),
    pollIntervalMs: readNumber("POLYMARKET_POLL_INTERVAL_MS", DEFAULTS.pollIntervalMs),
    startupLookbackBlocks: readNumber(
      "POLYMARKET_STARTUP_LOOKBACK_BLOCKS",
      DEFAULTS.startupLookbackBlocks
    ),
    blockBatchSize: readNumber("POLYMARKET_BLOCK_BATCH_SIZE", DEFAULTS.blockBatchSize),
    activityPageSize: readNumber("POLYMARKET_ACTIVITY_PAGE_SIZE", DEFAULTS.activityPageSize),
    activityPageCount: readNumber("POLYMARKET_ACTIVITY_PAGE_COUNT", DEFAULTS.activityPageCount),
    priceCacheMs: readNumber("POLYMARKET_PRICE_CACHE_MS", DEFAULTS.priceCacheMs),
    maxTrackedWallets: readNumber("POLYMARKET_MAX_TRACKED_WALLETS", DEFAULTS.maxTrackedWallets),
    maxSeenFundingTransfers: readNumber(
      "POLYMARKET_MAX_SEEN_FUNDING_TRANSFERS",
      DEFAULTS.maxSeenFundingTransfers
    ),
    maxSentEventKeys: readNumber("POLYMARKET_MAX_SENT_EVENT_KEYS", DEFAULTS.maxSentEventKeys),
    maxRecentAlerts: readNumber("POLYMARKET_MAX_RECENT_ALERTS", DEFAULTS.maxRecentAlerts),
    requestTimeoutMs: readNumber("POLYMARKET_REQUEST_TIMEOUT_MS", DEFAULTS.requestTimeoutMs),
    refreshConcurrency: readNumber("POLYMARKET_REFRESH_CONCURRENCY", DEFAULTS.refreshConcurrency),
    stateFile: path.resolve(process.env["POLYMARKET_STATE_FILE"] ?? DEFAULTS.stateFile),
    webhookUrl: process.env["POLYMARKET_WEBHOOK_URL"] ?? DEFAULTS.webhookUrl,
    bootstrapMode,
    host: process.env["HOST"] ?? DEFAULTS.host,
    port: readNumber("PORT", DEFAULTS.port)
  };
}
