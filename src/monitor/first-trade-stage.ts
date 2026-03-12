import { getTradeUsdSize } from "../polymarket-data-client.js";

import type { FirstTradeRecord, PolymarketActivityRow, PublishedMonitorAlert } from "../types.js";
import { defaultTradeFirstUse, deriveWalletStatus, summarizeTrades, toIsoFromUnix } from "./shared.js";
import { registerFirstUse } from "./first-use-stage.js";
import type { MonitorStageDependencies } from "./shared.js";

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
      status: "first-trade"
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

export async function refreshTrackedWallets(
  dependencies: MonitorStageDependencies
): Promise<{ checkedWallets: number; alerts: PublishedMonitorAlert[] }> {
  const trackedWallets = dependencies.stateStore.listTrackedWallets();
  const alerts: PublishedMonitorAlert[] = [];
  let checkedWallets = 0;

  for (const walletRecord of trackedWallets) {
    if (walletRecord.firstTrade) {
      continue;
    }

    checkedWallets += 1;

    const firstTrade = await dependencies.polymarketClient.getFirstTrade(walletRecord.wallet);

    if (firstTrade && firstTrade.timestamp >= walletRecord.firstFunding.timestamp) {
      const observedTrades = await dependencies.polymarketClient.getTradeActivitySince(
        walletRecord.wallet,
        walletRecord.firstFunding.timestamp
      );

      if (!walletRecord.firstUse) {
        const firstUseAlert = await registerFirstUse(dependencies, walletRecord.wallet, defaultTradeFirstUse(firstTrade));

        if (firstUseAlert) {
          alerts.push(firstUseAlert);
        }
      }

      const firstTradeAlert = await registerFirstTrade(dependencies, walletRecord.wallet, firstTrade, observedTrades);

      if (firstTradeAlert) {
        alerts.push(firstTradeAlert);
      }
    } else if (!walletRecord.firstUse) {
      const firstActivity = await dependencies.polymarketClient.getFirstActivity(walletRecord.wallet);

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
