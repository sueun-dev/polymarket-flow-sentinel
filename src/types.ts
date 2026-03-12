export type FetchLike = typeof fetch;
export type BootstrapMode = "skip" | "scan";
export type WalletKind = "EOA" | "Contract";
export type WalletStatus = "funded" | "first-use" | "first-trade";
export type ActivitySortDirection = "ASC" | "DESC";
export type PriceKind = "stable" | "token" | "native";

export interface LoggerLike {
  info(message?: unknown, ...args: unknown[]): void;
  error(message?: unknown, ...args: unknown[]): void;
}

export interface MonitorConfig {
  once: boolean;
  dataApiBaseUrl: string;
  polygonRpcUrl: string;
  minFundingUsd: number;
  minTradeUsd: number;
  pollIntervalMs: number;
  startupLookbackBlocks: number;
  blockBatchSize: number;
  activityPageSize: number;
  activityPageCount: number;
  priceCacheMs: number;
  maxTrackedWallets: number;
  maxSeenFundingTransfers: number;
  maxSentEventKeys: number;
  maxRecentAlerts: number;
  requestTimeoutMs: number;
  stateFile: string;
  webhookUrl: string;
  bootstrapMode: BootstrapMode;
  host: string;
  port: number;
}

export interface PolygonFundingAsset {
  symbol: string;
  address: string;
  decimals: number;
  priceKind: PriceKind;
}

export interface RpcLog {
  topics?: string[];
  data?: string;
  transactionHash?: string;
  blockNumber?: string;
  logIndex?: string;
}

export interface RpcTransaction {
  hash?: string;
  from?: string;
  to?: string | null;
  value?: string;
  blockNumber?: string;
  transactionIndex?: string;
}

export interface RpcBlock {
  number?: string;
  timestamp?: string;
  hash?: string;
  transactions?: RpcTransaction[];
}

export interface RpcErrorPayload {
  message?: string;
}

export interface RpcEnvelope<T> {
  result?: T;
  error?: RpcErrorPayload;
}

export interface DecodedTransferLog {
  type: "transfer";
  from: string;
  to: string;
  valueRaw: bigint;
  value: number;
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
}

export interface DecodedApprovalLog {
  type: "approval";
  owner: string;
  spender: string;
  valueRaw: bigint;
  value: number;
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
}

export interface DecodedApprovalForAllLog {
  type: "approvalForAll";
  account: string;
  operator: string;
  approved: boolean;
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
}

export interface NativeTransfer {
  type: "native-transfer";
  from: string;
  to: string;
  valueRaw: bigint;
  value: number;
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
}

export type ChainTransfer = DecodedTransferLog | NativeTransfer;

export type PricedFundingTransfer = ChainTransfer & {
  assetSymbol: string;
  assetAddress: string;
  amountToken: number;
};

export interface FundingRecord {
  assetSymbol: string;
  assetAddress: string;
  amountToken: number;
  amountUsd: number;
  from: string;
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
  timestamp: number;
  timestampIso: string;
}

export interface FirstUseRecord {
  kind: string;
  timestamp: number;
  transactionHash?: string;
  blockNumber?: number | null;
  contract?: string;
}

export interface PolymarketActivityRow {
  transactionHash: string;
  timestamp: number;
  title?: string;
  outcome?: string;
  side?: string;
  slug?: string;
  usdcSize?: number;
  size?: number;
  price?: number;
  type?: string;
  proxyWallet?: string;
}

export interface ActivityQuery {
  user: string;
  type?: string;
  limit?: number;
  offset?: number;
  start?: number;
  end?: number;
  sortDirection?: ActivitySortDirection;
}

export interface FirstTradeRecord {
  title: string;
  outcome: string;
  side: string;
  marketSlug: string;
  transactionHash: string;
  timestamp: number;
  timestampIso: string;
  usdSize: number;
  observedTradeCount: number;
  observedTradeUsd: number;
  secondsFromFunding: number;
}

export interface TrackedWalletRecord {
  wallet: string;
  walletKind: WalletKind;
  status: WalletStatus;
  totalFundedUsd: number;
  fundingCount: number;
  firstFunding: FundingRecord;
  latestFunding: FundingRecord;
  firstUse: FirstUseRecord | null;
  firstTrade: FirstTradeRecord | null;
  lastCheckedAt: string | null;
}

export interface FundingAlert {
  stage: "funding";
  wallet: string;
  walletKind: WalletKind;
  assetSymbol: string;
  amountToken: number;
  amountUsd: number;
  fundedUsd: number;
  from: string;
  transactionHash: string;
  blockNumber: number;
  timestamp: number;
  uniqueKey: string;
}

export interface FirstUseAlert {
  stage: "first-use";
  wallet: string;
  useKind: string;
  fundedUsd: number;
  transactionHash: string | undefined;
  blockNumber: number | null;
  timestamp: number;
  uniqueKey: string;
}

export interface FirstTradeAlert {
  stage: "first-trade";
  wallet: string;
  tradeUsd: number;
  fundedUsd: number;
  observedTradeUsd: number;
  observedTradeCount: number;
  title: string;
  outcome: string;
  side: string;
  marketSlug: string;
  transactionHash: string;
  blockNumber: number | null;
  timestamp: number;
  uniqueKey: string;
}

export type PendingMonitorAlert = FundingAlert | FirstUseAlert | FirstTradeAlert;

export interface PublishedAlertFields {
  message: string;
  triggeredAt: string;
}

export type PublishedMonitorAlert = PendingMonitorAlert & PublishedAlertFields;

export interface MonitorRunResult {
  alerts: PublishedMonitorAlert[];
  bootstrapped: boolean;
  latestBlock: number;
  lastProcessedBlock: number;
  processedBlocks: number;
  newTrackedWallets: number;
  checkedWallets: number;
}

export interface ChainSyncStatus {
  latestBlock: number;
  lastProcessedBlock: number;
  lagBlocks: number;
  checkedAt: string;
  processedBlocks?: number;
  bootstrapped?: boolean;
}

export interface MonitorStats {
  trackedWalletCount: number;
  firstUseCount: number;
  firstTradeCount: number;
  recentAlertCount: number;
  lastAlertAt: string | null;
}

export interface SuccessfulPollSummary {
  reason: string;
  completedAt: string;
  alertCount: number;
  processedBlocks: number;
  latestBlock: number;
  lastProcessedBlock: number;
  newTrackedWallets: number;
  checkedWallets: number;
  bootstrapped: boolean;
}

export interface FailedPollSummary {
  reason: string;
  completedAt: string;
  error: string;
}

export type MonitorLastResult = SuccessfulPollSummary | FailedPollSummary | null;

export interface MonitorSnapshot {
  monitor: {
    running: boolean;
    polling: boolean;
    bootstrapped: boolean;
    fundingThresholdUsd: number;
    tradeThresholdUsd: number;
    pollIntervalMs: number;
    bootstrapMode: BootstrapMode;
    polygonRpcUrl: string;
    webhookConfigured: boolean;
    lastPollAt: string | null;
    lastSuccessfulPollAt: string | null;
    lastError: string | null;
    lastResult: MonitorLastResult;
    lastChainSync: ChainSyncStatus | null;
  };
  stats: MonitorStats;
  watchlist: TrackedWalletRecord[];
  alerts: PublishedMonitorAlert[];
}

export interface MonitorStatusState {
  lastChainSync: ChainSyncStatus | null;
}

export interface PersistedMonitorState {
  bootstrapped: boolean;
  lastProcessedBlock: number | null;
  seenFundingTransferKeys: string[];
  sentEventKeys: string[];
  trackedWallets: Record<string, TrackedWalletRecord>;
  recentAlerts: PublishedMonitorAlert[];
  monitorStatus: MonitorStatusState;
}

export interface PolygonClientLike {
  getBlockNumber(): Promise<number>;
  getCode(address: string): Promise<string>;
  getBlockTimestamp(blockNumber: number): Promise<number>;
  getErc20TransferLogs(input: {
    fromBlock: number;
    toBlock: number;
    address: string;
    decimals: number;
  }): Promise<DecodedTransferLog[]>;
  getNativeTransfers(input: { fromBlock: number; toBlock: number }): Promise<NativeTransfer[]>;
  getUsdcApprovalLogs(input: {
    fromBlock: number;
    toBlock: number;
    address: string;
    spender?: string;
  }): Promise<DecodedApprovalLog[]>;
  getApprovalForAllLogs(input: {
    fromBlock: number;
    toBlock: number;
    address: string;
  }): Promise<DecodedApprovalForAllLog[]>;
}

export interface PolymarketDataClientLike {
  getCanonicalProfileWallet(wallet: string): Promise<string | null>;
  getFirstActivity(wallet: string): Promise<PolymarketActivityRow | null>;
  getFirstTrade(wallet: string): Promise<PolymarketActivityRow | null>;
  getTradeActivitySince(wallet: string, startTimestamp: number): Promise<PolymarketActivityRow[]>;
}

export interface AssetPriceClientLike {
  getUsdPrice(asset: PolygonFundingAsset): Promise<number>;
}

export interface MonitorStateStoreLike {
  load(): Promise<void>;
  save(): Promise<void>;
  setBootstrapped(value: boolean): void;
  isBootstrapped(): boolean;
  getLastProcessedBlock(): number | null;
  setLastProcessedBlock(blockNumber: number): void;
  hasSeenFundingTransfer(key: string): boolean;
  markFundingTransferSeen(key: string): void;
  hasSentEvent(key: string): boolean;
  markEventSent(key: string): void;
  getTrackedWallet(wallet: string): TrackedWalletRecord | null;
  upsertTrackedWallet(
    wallet: string,
    updater: (currentValue: TrackedWalletRecord | null) => TrackedWalletRecord | null
  ): TrackedWalletRecord | null;
  listTrackedWallets(): TrackedWalletRecord[];
  addRecentAlert(alert: PublishedMonitorAlert, maxRecentAlerts: number): void;
  getRecentAlerts(limit?: number): PublishedMonitorAlert[];
  getTrackedWalletStats(): {
    trackedWalletCount: number;
    firstUseCount: number;
    firstTradeCount: number;
  };
  recordMonitorSync(status: ChainSyncStatus): void;
  getMonitorStatus(): MonitorStatusState;
}

export interface CreateAppResult {
  config: MonitorConfig;
  polygonRpcClient: PolygonClientLike;
  polymarketDataClient: PolymarketDataClientLike;
  assetPriceClient: AssetPriceClientLike;
  stateStore: MonitorStateStoreLike;
  monitor: {
    initialize(): Promise<void>;
    runOnce(): Promise<MonitorRunResult>;
  };
  runtime: {
    initialize(): Promise<void>;
    start(): void;
    stop(): void;
    scanNow(reason?: string): Promise<MonitorRunResult>;
    getSnapshot(): MonitorSnapshot;
    on(eventName: "snapshot", listener: (snapshot: MonitorSnapshot) => void): unknown;
    on(eventName: "alert", listener: (alert: PublishedMonitorAlert) => void): unknown;
  };
}
