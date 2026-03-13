import { POLYGON_FUNDING_ASSETS } from "../polygon-funding-assets.js";

import type {
  FundingRecord,
  PricedFundingTransfer,
  PublishedMonitorAlert,
  TrackedWalletRecord,
  WalletKind
} from "../types.js";
import {
  IGNORED_WALLETS,
  createFundingTransferKey,
  deriveWalletStatus,
  isEmptyCode,
  normalizeAddress,
  sortByBlockAndIndex,
  toIsoFromUnix
} from "./shared.js";
import type {
  FundingRegistrationResult,
  MonitorStageContext,
  MonitorStageDependencies
} from "./shared.js";

function buildTrackedWalletRecord(
  wallet: string,
  funding: FundingRecord,
  walletKind: WalletKind
): TrackedWalletRecord {
  return {
    wallet,
    walletKind,
    status: "funded",
    totalFundedUsd: funding.amountUsd,
    fundingCount: 1,
    firstFunding: funding,
    latestFunding: funding,
    firstUse: null,
    firstTrade: null,
    lastCheckedAt: null,
    totalDepositedUsdc: 0,
    depositCount: 0,
    firstDeposit: null,
    latestDeposit: null,
    positions: [],
    totalBetUsd: 0,
    positionCount: 0
  };
}

async function registerFunding(
  dependencies: MonitorStageDependencies,
  transfer: PricedFundingTransfer
): Promise<FundingRegistrationResult> {
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
  const wallet = transfer.to;

  if (!wallet || IGNORED_WALLETS.has(wallet)) {
    return { tracked: false, alert: null };
  }

  const existing = dependencies.stateStore.getTrackedWallet(wallet);

  if (!existing) {
    const canonicalProfileWallet =
      await dependencies.polymarketClient.getCanonicalProfileWallet(wallet);

    if (
      canonicalProfileWallet &&
      normalizeAddress(canonicalProfileWallet) !== normalizeAddress(wallet)
    ) {
      return { tracked: false, alert: null };
    }

    const firstActivity = await dependencies.polymarketClient.getFirstActivity(wallet);

    if (firstActivity && firstActivity.timestamp < fundingTimestamp) {
      return { tracked: false, alert: null };
    }

    const walletCode = await dependencies.polygonClient.getCode(wallet);
    const walletKind: WalletKind = isEmptyCode(walletCode) ? "EOA" : "Contract";
    const record = buildTrackedWalletRecord(wallet, funding, walletKind);
    dependencies.stateStore.upsertTrackedWallet(wallet, () => record);

    const alert = await dependencies.emitAlert({
      stage: "funding",
      wallet,
      walletKind,
      assetSymbol: funding.assetSymbol,
      amountToken: funding.amountToken,
      amountUsd: funding.amountUsd,
      fundedUsd: funding.amountUsd,
      from: funding.from,
      transactionHash: funding.transactionHash,
      blockNumber: funding.blockNumber,
      timestamp: funding.timestamp,
      uniqueKey: `${funding.transactionHash}:${funding.logIndex}`
    });

    return { tracked: true, alert };
  }

  if (existing.firstTrade) {
    return { tracked: true, alert: null };
  }

  dependencies.stateStore.upsertTrackedWallet(wallet, (current) => {
    if (!current) {
      return null;
    }

    const nextRecord: TrackedWalletRecord = {
      ...current,
      totalFundedUsd: current.totalFundedUsd + funding.amountUsd,
      fundingCount: current.fundingCount + 1,
      latestFunding: funding,
      status: deriveWalletStatus(current)
    };
    return nextRecord;
  });

  const updated = dependencies.stateStore.getTrackedWallet(wallet);
  if (!updated) {
    return { tracked: true, alert: null };
  }

  const alert = await dependencies.emitAlert({
    stage: "funding",
    wallet,
    walletKind: updated.walletKind,
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

  return { tracked: true, alert };
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
): Promise<{ newTrackedWallets: number; alerts: PublishedMonitorAlert[] }> {
  const transfers = await collectFundingTransfers(dependencies, fromBlock, toBlock);
  const sameTransactionSenders = new Set(
    transfers.map((transfer) => `${transfer.transactionHash}:${normalizeAddress(transfer.from)}`)
  );
  const candidateTransfers = transfers
    .filter(
      (transfer) =>
        transfer.value >= dependencies.config.minFundingUsd &&
        !sameTransactionSenders.has(`${transfer.transactionHash}:${normalizeAddress(transfer.to)}`)
    )
    .sort(sortByBlockAndIndex);

  let newTrackedWallets = 0;
  const alerts: PublishedMonitorAlert[] = [];

  for (const transfer of candidateTransfers) {
    const transferKey = createFundingTransferKey(transfer);

    if (dependencies.stateStore.hasSeenFundingTransfer(transferKey)) {
      continue;
    }

    dependencies.stateStore.markFundingTransferSeen(transferKey);
    const result = await registerFunding(dependencies, transfer);

    if (result.tracked) {
      const existing = dependencies.stateStore.getTrackedWallet(transfer.to);

      if (
        existing?.fundingCount === 1 &&
        existing.firstFunding.transactionHash === transfer.transactionHash
      ) {
        newTrackedWallets += 1;
      }
    }

    if (result.alert) {
      alerts.push(result.alert);
    }
  }

  return {
    newTrackedWallets,
    alerts
  };
}
