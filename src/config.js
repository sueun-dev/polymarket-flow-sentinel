import path from "node:path";

const DEFAULTS = {
  dataApiBaseUrl: "https://data-api.polymarket.com",
  polygonRpcUrl: "https://polygon.drpc.org",
  minFundingUsd: 50_000,
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
  stateFile: path.resolve(process.cwd(), ".data/polymarket-flow-sentinel.json"),
  bootstrapMode: "scan",
  host: "0.0.0.0",
  port: 3000
};

function readNumber(name, fallback, { allowZero = false } = {}) {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`Environment variable ${name} must be ${allowZero ? "a non-negative" : "a positive"} number.`);
  }

  return value;
}

export function loadConfig(argv = process.argv.slice(2)) {
  const once = argv.includes("--once");
  const bootstrapMode = process.env.POLYMARKET_BOOTSTRAP_MODE ?? DEFAULTS.bootstrapMode;

  if (!["skip", "scan"].includes(bootstrapMode)) {
    throw new Error("POLYMARKET_BOOTSTRAP_MODE must be either 'skip' or 'scan'.");
  }

  return {
    once,
    dataApiBaseUrl: process.env.POLYMARKET_DATA_API_BASE_URL ?? DEFAULTS.dataApiBaseUrl,
    polygonRpcUrl: process.env.POLYGON_RPC_URL ?? DEFAULTS.polygonRpcUrl,
    minFundingUsd: readNumber("POLYMARKET_MIN_FUNDING_USD", DEFAULTS.minFundingUsd),
    minTradeUsd: readNumber("POLYMARKET_MIN_TRADE_USD", DEFAULTS.minTradeUsd, { allowZero: true }),
    pollIntervalMs: readNumber("POLYMARKET_POLL_INTERVAL_MS", DEFAULTS.pollIntervalMs),
    startupLookbackBlocks: readNumber("POLYMARKET_STARTUP_LOOKBACK_BLOCKS", DEFAULTS.startupLookbackBlocks),
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
    stateFile: path.resolve(process.env.POLYMARKET_STATE_FILE ?? DEFAULTS.stateFile),
    webhookUrl: process.env.POLYMARKET_WEBHOOK_URL ?? "",
    bootstrapMode,
    host: process.env.HOST ?? DEFAULTS.host,
    port: readNumber("PORT", DEFAULTS.port)
  };
}
