import { getTradeUsdSize } from "../polymarket-data-client.js";

import type {
  FirstTradeRecord,
  PolymarketActivityRow,
  PositionRecord,
  PublishedMonitorAlert
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

export async function refreshTrackedWallets(
  dependencies: MonitorStageDependencies
): Promise<{ checkedWallets: number; alerts: PublishedMonitorAlert[] }> {
  const trackedWallets = dependencies.stateStore.listTrackedWallets();
  const alerts: PublishedMonitorAlert[] = [];
  let checkedWallets = 0;

  for (const walletRecord of trackedWallets) {
    if (walletRecord.status === "depleted") {
      continue;
    }

    checkedWallets += 1;

    if (!walletRecord.firstTrade) {
      // Original first-trade detection path
      const firstTrade = await dependencies.polymarketClient.getFirstTrade(walletRecord.wallet);

      if (firstTrade && firstTrade.timestamp >= walletRecord.firstFunding.timestamp) {
        const observedTrades = await dependencies.polymarketClient.getTradeActivitySince(
          walletRecord.wallet,
          walletRecord.firstFunding.timestamp
        );

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
          observedTrades
        );

        if (firstTradeAlert) {
          alerts.push(firstTradeAlert);
        }

        const observedPositions = filterUniquePositions(
          observedTrades.map((trade) => toPositionRecord(trade))
        );
        const positionAlerts = await registerNewPositions(
          dependencies,
          walletRecord.wallet,
          observedPositions
        );
        alerts.push(...positionAlerts);
      } else if (!walletRecord.firstUse) {
        const firstActivity = await dependencies.polymarketClient.getFirstActivity(
          walletRecord.wallet
        );

        if (firstActivity && firstActivity.timestamp >= walletRecord.firstFunding.timestamp) {
          const firstUseAlert = await registerFirstUse(dependencies, walletRecord.wallet, {
            kind: `activity:${(firstActivity.type ?? "UNKNOWN").toLowerCase()}`,
            transactionHash: firstActivity.transactionHash,
            timestamp: firstActivity.timestamp
          });

          if (firstUseAlert) {
            alerts.push(firstUseAlert);
          }
        }
      }
    } else {
      // Continuous position tracking for wallets that already have a first trade
      const lastPosition = walletRecord.positions[walletRecord.positions.length - 1];
      const sinceTimestamp = lastPosition
        ? lastPosition.timestamp
        : walletRecord.firstTrade.timestamp;

      const newTrades = await dependencies.polymarketClient.getTradeActivitySince(
        walletRecord.wallet,
        sinceTimestamp
      );

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
  }

  return {
    checkedWallets,
    alerts
  };
}
