import { getTradeUsdSize } from "../polymarket-data-client.js";

import type {
  FirstTradeRecord,
  PolymarketActivityRow,
  PositionRecord,
  PublishedMonitorAlert,
  TrackedWalletRecord
} from "../types.js";
import {
  defaultTradeFirstUse,
  deriveWalletStatus,
  summarizeTrades,
  toIsoFromUnix
} from "./shared.js";
import { registerFirstUse } from "./first-use-stage.js";
import type { MonitorStageDependencies } from "./shared.js";

function createPositionKey(
  position: Pick<
    PositionRecord,
    "transactionHash" | "timestamp" | "marketSlug" | "title" | "outcome" | "side" | "usdSize"
  >
): string {
  return JSON.stringify([
    position.transactionHash,
    position.timestamp,
    position.marketSlug,
    position.title,
    position.outcome,
    position.side,
    position.usdSize
  ]);
}

async function registerFirstTrade(
  dependencies: MonitorStageDependencies,
  wallet: string,
  trade: PolymarketActivityRow,
  observedTrades: readonly PolymarketActivityRow[]
): Promise<PublishedMonitorAlert | null> {
  const current = dependencies.stateStore.getTrackedWallet(wallet);

  if (!current || current.firstTrade) {
    return null;
  }

  const tradeUsd = getTradeUsdSize(trade);
  const observedSummary = summarizeTrades(observedTrades);
  const firstTrade: FirstTradeRecord = {
    title: trade.title ?? "Unknown market",
    outcome: trade.outcome ?? "",
    side: trade.side ?? "",
    marketSlug: trade.slug ?? "",
    transactionHash: trade.transactionHash,
    timestamp: trade.timestamp,
    timestampIso: toIsoFromUnix(trade.timestamp),
    usdSize: tradeUsd,
    observedTradeCount: observedSummary.count,
    observedTradeUsd: observedSummary.usd,
    secondsFromFunding: Math.max(0, trade.timestamp - current.firstFunding.timestamp)
  };

  dependencies.stateStore.upsertTrackedWallet(wallet, (record) => {
    if (!record) {
      return null;
    }

    return {
      ...record,
      firstUse: record.firstUse ?? defaultTradeFirstUse(trade),
      firstTrade,
      status: "active"
    };
  });

  if (tradeUsd < dependencies.config.minTradeUsd) {
    return null;
  }

  return dependencies.emitAlert({
    stage: "first-trade",
    wallet,
    tradeUsd,
    fundedUsd: current.totalFundedUsd,
    observedTradeUsd: observedSummary.usd,
    observedTradeCount: observedSummary.count,
    title: firstTrade.title,
    outcome: firstTrade.outcome,
    side: firstTrade.side,
    marketSlug: firstTrade.marketSlug,
    transactionHash: firstTrade.transactionHash,
    blockNumber: null,
    timestamp: firstTrade.timestamp,
    uniqueKey: firstTrade.transactionHash
  });
}

function toPositionRecord(trade: PolymarketActivityRow): PositionRecord {
  return {
    title: trade.title ?? "Unknown market",
    outcome: trade.outcome ?? "",
    side: trade.side ?? "",
    marketSlug: trade.slug ?? "",
    usdSize: getTradeUsdSize(trade),
    transactionHash: trade.transactionHash,
    timestamp: trade.timestamp,
    timestampIso: toIsoFromUnix(trade.timestamp)
  };
}

function filterUniquePositions(
  positions: readonly PositionRecord[],
  existingKeys = new Set<string>()
): PositionRecord[] {
  const freshPositions: PositionRecord[] = [];

  for (const position of positions) {
    const positionKey = createPositionKey(position);

    if (existingKeys.has(positionKey)) {
      continue;
    }

    existingKeys.add(positionKey);
    freshPositions.push(position);
  }

  return freshPositions;
}

async function registerNewPositions(
  dependencies: MonitorStageDependencies,
  wallet: string,
  positions: readonly PositionRecord[]
): Promise<PublishedMonitorAlert[]> {
  const alerts: PublishedMonitorAlert[] = [];

  for (const position of positions) {
    dependencies.stateStore.upsertTrackedWallet(wallet, (record) => {
      if (!record) {
        return null;
      }

      const nextRecord = {
        ...record,
        positions: [...record.positions, position],
        totalBetUsd: record.totalBetUsd + position.usdSize,
        positionCount: record.positionCount + 1
      };

      return {
        ...nextRecord,
        status: deriveWalletStatus(nextRecord)
      };
    });

    const updated = dependencies.stateStore.getTrackedWallet(wallet);
    if (!updated) {
      continue;
    }

    const alert = await dependencies.emitAlert({
      stage: "position",
      wallet,
      title: position.title,
      outcome: position.outcome,
      side: position.side,
      marketSlug: position.marketSlug,
      usdSize: position.usdSize,
      totalBetUsd: updated.totalBetUsd,
      fundedUsd: updated.totalFundedUsd,
      totalDepositedUsdc: updated.totalDepositedUsdc,
      transactionHash: position.transactionHash,
      blockNumber: null,
      timestamp: position.timestamp,
      uniqueKey: createPositionKey(position)
    });

    if (alert) {
      alerts.push(alert);
    }
  }

  return alerts;
}

async function refreshSingleWallet(
  dependencies: MonitorStageDependencies,
  walletRecord: TrackedWalletRecord
): Promise<PublishedMonitorAlert[]> {
  const alerts: PublishedMonitorAlert[] = [];

  if (!walletRecord.firstTrade) {
    // Check the primary wallet and all aliases for first trade
    const walletsToCheck = [walletRecord.wallet, ...(walletRecord.aliases ?? [])];
    let firstTrade: PolymarketActivityRow | null = null;

    for (const addr of walletsToCheck) {
      const trade = await dependencies.polymarketClient.getFirstTrade(addr);
      if (trade && trade.timestamp >= walletRecord.firstFunding.timestamp) {
        if (!firstTrade || trade.timestamp < firstTrade.timestamp) {
          firstTrade = trade;
        }
      }
    }

    if (firstTrade) {
      // Gather trades from all wallets in the identity
      const allTrades: PolymarketActivityRow[] = [];
      for (const addr of walletsToCheck) {
        const trades = await dependencies.polymarketClient.getTradeActivitySince(
          addr,
          walletRecord.firstFunding.timestamp
        );
        allTrades.push(...trades);
      }
      allTrades.sort((a, b) => a.timestamp - b.timestamp);

      if (!walletRecord.firstUse) {
        const firstUseAlert = await registerFirstUse(
          dependencies,
          walletRecord.wallet,
          defaultTradeFirstUse(firstTrade)
        );

        if (firstUseAlert) {
          alerts.push(firstUseAlert);
        }
      }

      const firstTradeAlert = await registerFirstTrade(
        dependencies,
        walletRecord.wallet,
        firstTrade,
        allTrades
      );

      if (firstTradeAlert) {
        alerts.push(firstTradeAlert);
      }

      const observedPositions = filterUniquePositions(
        allTrades.map((trade) => toPositionRecord(trade))
      );
      const positionAlerts = await registerNewPositions(
        dependencies,
        walletRecord.wallet,
        observedPositions
      );
      alerts.push(...positionAlerts);
    } else if (!walletRecord.firstUse) {
      // Check activity across all wallets in the identity
      for (const addr of walletsToCheck) {
        const firstActivity = await dependencies.polymarketClient.getFirstActivity(addr);

        if (firstActivity && firstActivity.timestamp >= walletRecord.firstFunding.timestamp) {
          const firstUseAlert = await registerFirstUse(dependencies, walletRecord.wallet, {
            kind: `activity:${(firstActivity.type ?? "UNKNOWN").toLowerCase()}`,
            transactionHash: firstActivity.transactionHash,
            timestamp: firstActivity.timestamp
          });

          if (firstUseAlert) {
            alerts.push(firstUseAlert);
          }
          break;
        }
      }
    }
  } else {
    // Continuous position tracking for wallets that already have a first trade
    const lastPosition = walletRecord.positions[walletRecord.positions.length - 1];
    const sinceTimestamp = lastPosition
      ? lastPosition.timestamp
      : walletRecord.firstTrade.timestamp;

    const walletsToCheck = [walletRecord.wallet, ...(walletRecord.aliases ?? [])];
    const newTrades: PolymarketActivityRow[] = [];
    for (const addr of walletsToCheck) {
      const trades = await dependencies.polymarketClient.getTradeActivitySince(
        addr,
        sinceTimestamp
      );
      newTrades.push(...trades);
    }
    newTrades.sort((a, b) => a.timestamp - b.timestamp);

    const existingPositionKeys = new Set(
      walletRecord.positions.map((position) => createPositionKey(position))
    );
    const freshPositions = filterUniquePositions(
      newTrades.map((trade) => toPositionRecord(trade)),
      existingPositionKeys
    );

    if (freshPositions.length > 0) {
      const positionAlerts = await registerNewPositions(
        dependencies,
        walletRecord.wallet,
        freshPositions
      );
      alerts.push(...positionAlerts);
    }
  }

  dependencies.stateStore.upsertTrackedWallet(walletRecord.wallet, (record) => {
    if (!record) {
      return null;
    }

    return {
      ...record,
      lastCheckedAt: new Date().toISOString(),
      status: deriveWalletStatus(record)
    };
  });

  return alerts;
}

async function runConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function next(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex]!);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

export async function refreshTrackedWallets(
  dependencies: MonitorStageDependencies
): Promise<{ checkedWallets: number; alerts: PublishedMonitorAlert[] }> {
  const trackedWallets = dependencies.stateStore.listTrackedWallets();
  const activeWallets = trackedWallets.filter((w) => w.status !== "depleted");
  const concurrency = dependencies.config.refreshConcurrency;

  const allAlerts = await runConcurrent(activeWallets, concurrency, (walletRecord) =>
    refreshSingleWallet(dependencies, walletRecord)
  );

  return {
    checkedWallets: activeWallets.length,
    alerts: allAlerts.flat()
  };
}
