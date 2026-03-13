import type { DepositRecord, PublishedMonitorAlert } from "../types.js";
import {
  DEPOSIT_DESTINATIONS,
  deriveWalletStatus,
  normalizeAddress,
  sortByBlockAndIndex,
  toIsoFromUnix
} from "./shared.js";
import type { MonitorStageDependencies } from "./shared.js";

export async function processDepositSignals(
  dependencies: MonitorStageDependencies,
  fromBlock: number,
  toBlock: number
): Promise<{ alerts: PublishedMonitorAlert[] }> {
  const transfers = await dependencies.polygonClient.getUsdcTransfersToAddresses({
    fromBlock,
    toBlock,
    destinations: DEPOSIT_DESTINATIONS
  });

  const alerts: PublishedMonitorAlert[] = [];

  for (const transfer of transfers.sort(sortByBlockAndIndex)) {
    const wallet = normalizeAddress(transfer.from);
    const record = dependencies.stateStore.getTrackedWallet(wallet);

    if (!record) {
      continue;
    }

    const timestamp = await dependencies.polygonClient.getBlockTimestamp(transfer.blockNumber);

    if (timestamp < record.firstFunding.timestamp) {
      continue;
    }

    const deposit: DepositRecord = {
      amountUsdc: transfer.value,
      destination: normalizeAddress(transfer.to),
      transactionHash: transfer.transactionHash,
      blockNumber: transfer.blockNumber,
      logIndex: transfer.logIndex,
      timestamp,
      timestampIso: toIsoFromUnix(timestamp)
    };

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

  return { alerts };
}
