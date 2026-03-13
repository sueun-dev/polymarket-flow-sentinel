import type { DepositRecord, FundingRecord, PublishedMonitorAlert, WalletKind } from "../types.js";
import {
  DEPOSIT_DESTINATIONS,
  IGNORED_WALLETS,
  deriveWalletStatus,
  isEmptyCode,
  normalizeAddress,
  sortByBlockAndIndex,
  toIsoFromUnix
} from "./shared.js";
import type { MonitorStageDependencies } from "./shared.js";

export async function processDepositSignals(
  dependencies: MonitorStageDependencies,
  fromBlock: number,
  toBlock: number
): Promise<{ newTrackedWallets: number; alerts: PublishedMonitorAlert[] }> {
  const transfers = await dependencies.polygonClient.getUsdcTransfersToAddresses({
    fromBlock,
    toBlock,
    destinations: DEPOSIT_DESTINATIONS
  });

  const alerts: PublishedMonitorAlert[] = [];
  let newTrackedWallets = 0;

  const minDeposit = dependencies.config.minDepositUsd;

  for (const transfer of transfers.sort(sortByBlockAndIndex)) {
    const wallet = normalizeAddress(transfer.from);

    if (!wallet || IGNORED_WALLETS.has(wallet)) {
      continue;
    }

    const timestamp = await dependencies.polygonClient.getBlockTimestamp(transfer.blockNumber);

    const deposit: DepositRecord = {
      amountUsdc: transfer.value,
      destination: normalizeAddress(transfer.to),
      transactionHash: transfer.transactionHash,
      blockNumber: transfer.blockNumber,
      logIndex: transfer.logIndex,
      timestamp,
      timestampIso: toIsoFromUnix(timestamp)
    };

    let record = dependencies.stateStore.getTrackedWallet(wallet);

    // New wallet depositing to Polymarket — only register if cumulative deposits >= threshold
    if (!record) {
      // Use persistent pendingFunding to accumulate across batches
      const pending = dependencies.stateStore.getPendingFunding(wallet);
      const runningTotal = (pending?.totalUsd ?? 0) + deposit.amountUsdc;

      if (runningTotal < minDeposit) {
        dependencies.stateStore.upsertPendingFunding(wallet, {
          wallet,
          totalUsd: runningTotal,
          transferCount: (pending?.transferCount ?? 0) + 1,
          firstSeenTimestamp: pending?.firstSeenTimestamp ?? timestamp,
          latestTransfer: {
            assetSymbol: "USDC.e",
            assetAddress: DEPOSIT_DESTINATIONS[0]!,
            amountToken: deposit.amountUsdc,
            amountUsd: deposit.amountUsdc,
            from: wallet,
            transactionHash: deposit.transactionHash,
            blockNumber: deposit.blockNumber,
            logIndex: deposit.logIndex,
            timestamp,
            timestampIso: toIsoFromUnix(timestamp)
          }
        });
        continue;
      }

      // Threshold crossed — remove pending and register
      dependencies.stateStore.removePendingFunding(wallet);
      const walletCode = await dependencies.polygonClient.getCode(wallet);
      const walletKind: WalletKind = isEmptyCode(walletCode) ? "EOA" : "Contract";

      const canonicalProfileWallet =
        await dependencies.polymarketClient.getCanonicalProfileWallet(wallet);
      const aliases: string[] = [];
      if (
        canonicalProfileWallet &&
        normalizeAddress(canonicalProfileWallet) !== normalizeAddress(wallet)
      ) {
        aliases.push(normalizeAddress(canonicalProfileWallet));
      }

      // Use the deposit as the initial "funding" record
      const initialFunding: FundingRecord = {
        assetSymbol: "USDC.e",
        assetAddress: DEPOSIT_DESTINATIONS[0]!,
        amountToken: deposit.amountUsdc,
        amountUsd: deposit.amountUsdc,
        from: wallet,
        transactionHash: deposit.transactionHash,
        blockNumber: deposit.blockNumber,
        logIndex: deposit.logIndex,
        timestamp: deposit.timestamp,
        timestampIso: deposit.timestampIso
      };

      dependencies.stateStore.upsertTrackedWallet(wallet, () => ({
        wallet,
        walletKind,
        status: "funded",
        aliases,
        totalFundedUsd: deposit.amountUsdc,
        fundingCount: 1,
        firstFunding: initialFunding,
        latestFunding: initialFunding,
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
      }));

      record = dependencies.stateStore.getTrackedWallet(wallet);
      newTrackedWallets += 1;
    }

    if (!record) {
      continue;
    }

    if (record.firstFunding && timestamp < record.firstFunding.timestamp) {
      continue;
    }

    dependencies.stateStore.upsertTrackedWallet(wallet, (current) => {
      if (!current) {
        return null;
      }

      const nextRecord = {
        ...current,
        totalDepositedUsdc: current.totalDepositedUsdc + deposit.amountUsdc,
        depositCount: current.depositCount + 1,
        firstDeposit: current.firstDeposit ?? deposit,
        latestDeposit: deposit
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
      stage: "deposit",
      wallet,
      amountUsdc: deposit.amountUsdc,
      totalDepositedUsdc: updated.totalDepositedUsdc,
      fundedUsd: updated.totalFundedUsd,
      destination: deposit.destination,
      transactionHash: deposit.transactionHash,
      blockNumber: deposit.blockNumber,
      timestamp: deposit.timestamp,
      uniqueKey: `${deposit.transactionHash}:${deposit.logIndex}`
    });

    if (alert) {
      alerts.push(alert);
    }
  }

  return { newTrackedWallets, alerts };
}
