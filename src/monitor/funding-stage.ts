import { POLYGON_FUNDING_ASSETS } from "../polygon-funding-assets.js";

import type {
  FundingRecord,
  PricedFundingTransfer,
  PublishedMonitorAlert,
  TrackedWalletRecord
} from "../types.js";
import {
  IGNORED_WALLETS,
  createFundingTransferKey,
  deriveWalletStatus,
  normalizeAddress,
  sortByBlockAndIndex,
  toIsoFromUnix
} from "./shared.js";
import type { MonitorStageContext, MonitorStageDependencies } from "./shared.js";

/**
 * Enrich an already-tracked wallet with additional funding data.
 * This stage never creates new tracked wallets — that's deposit-stage's job.
 */
async function enrichFunding(
  dependencies: MonitorStageDependencies,
  transfer: PricedFundingTransfer
): Promise<PublishedMonitorAlert | null> {
  const fundingTimestamp = await dependencies.polygonClient.getBlockTimestamp(transfer.blockNumber);
  const funding: FundingRecord = {
    assetSymbol: transfer.assetSymbol,
    assetAddress: transfer.assetAddress,
    amountToken: transfer.amountToken,
    amountUsd: transfer.value,
    from: transfer.from,
    transactionHash: transfer.transactionHash,
    blockNumber: transfer.blockNumber,
    logIndex: transfer.logIndex,
    timestamp: fundingTimestamp,
    timestampIso: toIsoFromUnix(fundingTimestamp)
  };
  const wallet = normalizeAddress(transfer.to);

  if (!wallet || IGNORED_WALLETS.has(wallet)) {
    return null;
  }

  const existing = dependencies.stateStore.getTrackedWallet(wallet);
  if (!existing) {
    // Not tracked — skip. Only deposit-stage registers new wallets.
    return null;
  }

  // Skip enrichment if wallet already has a first trade
  if (existing.firstTrade) {
    return null;
  }

  dependencies.stateStore.upsertTrackedWallet(wallet, (current) => {
    if (!current) {
      return null;
    }

    const nextRecord: TrackedWalletRecord = {
      ...current,
      totalFundedUsd: current.totalFundedUsd + funding.amountUsd,
      fundingCount: current.fundingCount + 1,
      firstFunding: current.firstFunding ?? funding,
      latestFunding: funding,
      status: deriveWalletStatus(current)
    };
    return nextRecord;
  });

  const updated = dependencies.stateStore.getTrackedWallet(wallet);
  if (!updated) {
    return null;
  }

  return dependencies.emitAlert({
    stage: "funding",
    wallet,
    walletKind: updated.walletKind,
    aliases: updated.aliases,
    assetSymbol: funding.assetSymbol,
    amountToken: funding.amountToken,
    amountUsd: funding.amountUsd,
    fundedUsd: updated.totalFundedUsd,
    from: funding.from,
    transactionHash: funding.transactionHash,
    blockNumber: funding.blockNumber,
    timestamp: funding.timestamp,
    uniqueKey: `${funding.transactionHash}:${funding.logIndex}`
  });
}

async function collectFundingTransfers(
  context: MonitorStageContext,
  fromBlock: number,
  toBlock: number
): Promise<PricedFundingTransfer[]> {
  const transfers: PricedFundingTransfer[] = [];

  for (const asset of POLYGON_FUNDING_ASSETS) {
    let usdPrice: number;

    try {
      usdPrice = await context.priceClient.getUsdPrice(asset);
    } catch (error: unknown) {
      context.logger.error(
        `Skipping funding asset ${asset.symbol} for blocks ${fromBlock}-${toBlock}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      continue;
    }

    if (asset.priceKind === "native") {
      const nativeTransfers = await context.polygonClient.getNativeTransfers({
        fromBlock,
        toBlock
      });

      for (const transfer of nativeTransfers) {
        transfers.push({
          ...transfer,
          assetSymbol: asset.symbol,
          assetAddress: asset.address,
          amountToken: transfer.value,
          value: transfer.value * usdPrice
        });
      }

      continue;
    }

    const tokenTransfers = await context.polygonClient.getErc20TransferLogs({
      fromBlock,
      toBlock,
      address: asset.address,
      decimals: asset.decimals
    });

    for (const transfer of tokenTransfers) {
      transfers.push({
        ...transfer,
        assetSymbol: asset.symbol,
        assetAddress: asset.address,
        amountToken: transfer.value,
        value: transfer.value * usdPrice
      });
    }
  }

  return transfers.sort(sortByBlockAndIndex);
}

export async function processFundingTransfers(
  dependencies: MonitorStageDependencies,
  fromBlock: number,
  toBlock: number
): Promise<{ alerts: PublishedMonitorAlert[] }> {
  const transfers = await collectFundingTransfers(dependencies, fromBlock, toBlock);
  const sameTransactionSenders = new Set(
    transfers.map((transfer) => `${transfer.transactionHash}:${normalizeAddress(transfer.from)}`)
  );

  const candidateTransfers = transfers
    .filter(
      (transfer) =>
        transfer.value > 0 &&
        !sameTransactionSenders.has(`${transfer.transactionHash}:${normalizeAddress(transfer.to)}`)
    )
    .sort(sortByBlockAndIndex);

  const alerts: PublishedMonitorAlert[] = [];

  for (const transfer of candidateTransfers) {
    const transferKey = createFundingTransferKey(transfer);

    if (dependencies.stateStore.hasSeenFundingTransfer(transferKey)) {
      continue;
    }

    dependencies.stateStore.markFundingTransferSeen(transferKey);

    const alert = await enrichFunding(dependencies, transfer);
    if (alert) {
      alerts.push(alert);
    }
  }

  return { alerts };
}
