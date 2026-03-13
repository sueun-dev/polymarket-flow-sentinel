import { POLYMARKET_CONTRACTS } from "../polymarket-address-book.js";
import { getTradeUsdSize } from "../polymarket-data-client.js";

import type {
  AssetPriceClientLike,
  FirstUseRecord,
  LoggerLike,
  MonitorConfig,
  MonitorStateStoreLike,
  PendingMonitorAlert,
  PolygonClientLike,
  PolymarketActivityRow,
  PolymarketDataClientLike,
  PricedFundingTransfer,
  PublishedMonitorAlert,
  TrackedWalletRecord,
  WalletStatus
} from "../types.js";

export interface SortableBlockPosition {
  blockNumber: number;
  logIndex: number;
}

export interface TradeSummary {
  count: number;
  usd: number;
}

export interface MonitorStageContext {
  polygonClient: PolygonClientLike;
  polymarketClient: PolymarketDataClientLike;
  priceClient: AssetPriceClientLike;
  stateStore: MonitorStateStoreLike;
  config: MonitorConfig;
  logger: LoggerLike;
}

export type EmitAlertFn = (alert: PendingMonitorAlert) => Promise<PublishedMonitorAlert | null>;

export interface MonitorStageDependencies extends MonitorStageContext {
  emitAlert: EmitAlertFn;
}

export const IGNORED_WALLETS = new Set<string>([
  ...Object.values(POLYMARKET_CONTRACTS).map((address) => address.toLowerCase()),
  "0x0000000000000000000000000000000000000000"
]);

export const DEPOSIT_DESTINATIONS: string[] = [
  POLYMARKET_CONTRACTS.conditionalTokens.toLowerCase(),
  POLYMARKET_CONTRACTS.negRiskAdapter.toLowerCase(),
  POLYMARKET_CONTRACTS.ctfExchange.toLowerCase(),
  POLYMARKET_CONTRACTS.negRiskCtfExchange.toLowerCase()
];

export function toIsoFromUnix(timestamp: number): string {
  return new Date(timestamp * 1_000).toISOString();
}

export function normalizeAddress(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

export function sortByBlockAndIndex<T extends SortableBlockPosition>(left: T, right: T): number {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber - right.blockNumber;
  }

  return left.logIndex - right.logIndex;
}

export function createFundingTransferKey(transfer: PricedFundingTransfer): string {
  return `${transfer.assetAddress}:${transfer.transactionHash}:${transfer.logIndex}:${normalizeAddress(transfer.to)}`;
}

export function createEventKey(
  stage: PendingMonitorAlert["stage"],
  wallet: string,
  uniquePart: string
): string {
  return `${normalizeAddress(wallet)}:${stage}:${uniquePart}`;
}

export function isEmptyCode(value: string): boolean {
  return /^0x0*$/i.test(value);
}

export function deriveWalletStatus(
  record: Pick<
    TrackedWalletRecord,
    "firstUse" | "firstTrade" | "totalDepositedUsdc" | "totalBetUsd" | "positionCount"
  >
): WalletStatus {
  if (record.totalDepositedUsdc > 0 && record.totalBetUsd >= record.totalDepositedUsdc) {
    return "depleted";
  }

  if (record.positionCount > 0 || record.firstTrade) {
    return "active";
  }

  if (record.firstUse) {
    return "first-use";
  }

  return "funded";
}

export function summarizeTrades(trades: readonly PolymarketActivityRow[]): TradeSummary {
  return trades.reduce<TradeSummary>(
    (summary, trade) => {
      summary.count += 1;
      summary.usd += getTradeUsdSize(trade);
      return summary;
    },
    { count: 0, usd: 0 }
  );
}

export function defaultTradeFirstUse(trade: PolymarketActivityRow): FirstUseRecord {
  return {
    kind: "trade-activity",
    timestamp: trade.timestamp,
    transactionHash: trade.transactionHash
  };
}
