import { FIRST_USE_CONTRACTS, POLYMARKET_CONTRACTS } from "../polymarket-address-book.js";

import type { FirstUseRecord, PublishedMonitorAlert } from "../types.js";
import { sortByBlockAndIndex } from "./shared.js";
import type { MonitorStageDependencies } from "./shared.js";

export async function registerFirstUse(
  dependencies: MonitorStageDependencies,
  wallet: string,
  use: FirstUseRecord
): Promise<PublishedMonitorAlert | null> {
  const current = dependencies.stateStore.getTrackedWallet(wallet);

  if (!current || current.firstUse) {
    return null;
  }

  dependencies.stateStore.upsertTrackedWallet(wallet, (record) => {
    if (!record) {
      return null;
    }

    return {
      ...record,
      firstUse: use,
      status: "first-use"
    };
  });

  const updated = dependencies.stateStore.getTrackedWallet(wallet);
  if (!updated) {
    return null;
  }

  return dependencies.emitAlert({
    stage: "first-use",
    wallet,
    useKind: use.kind,
    fundedUsd: updated.totalFundedUsd,
    transactionHash: use.transactionHash,
    blockNumber: use.blockNumber ?? null,
    timestamp: use.timestamp,
    uniqueKey: use.transactionHash ?? `${use.kind}:${use.timestamp}`
  });
}

export async function processOnChainUseSignals(
  dependencies: MonitorStageDependencies,
  fromBlock: number,
  toBlock: number
): Promise<{ alerts: PublishedMonitorAlert[] }> {
  const [usdcApprovals, approvalForAllLogs] = await Promise.all([
    dependencies.polygonClient.getUsdcApprovalLogs({
      fromBlock,
      toBlock,
      address: POLYMARKET_CONTRACTS.usdc,
      spender: POLYMARKET_CONTRACTS.conditionalTokens
    }),
    dependencies.polygonClient.getApprovalForAllLogs({
      fromBlock,
      toBlock,
      address: POLYMARKET_CONTRACTS.conditionalTokens
    })
  ]);

  const alerts: PublishedMonitorAlert[] = [];

  for (const approval of usdcApprovals.sort(sortByBlockAndIndex)) {
    if (
      !FIRST_USE_CONTRACTS.usdcApprovalSpenders.includes(approval.spender) ||
      approval.value <= 0
    ) {
      continue;
    }

    const wallet = approval.owner;
    const record = dependencies.stateStore.getTrackedWallet(wallet);

    if (!record || record.firstUse) {
      continue;
    }

    const timestamp = await dependencies.polygonClient.getBlockTimestamp(approval.blockNumber);

    if (timestamp < record.firstFunding.timestamp) {
      continue;
    }

    const alert = await registerFirstUse(dependencies, wallet, {
      kind: "USDC approval to CTF",
      contract: approval.spender,
      transactionHash: approval.transactionHash,
      blockNumber: approval.blockNumber,
      timestamp
    });

    if (alert) {
      alerts.push(alert);
    }
  }

  for (const approvalForAll of approvalForAllLogs.sort(sortByBlockAndIndex)) {
    if (
      !approvalForAll.approved ||
      !FIRST_USE_CONTRACTS.approvalForAllOperators.includes(approvalForAll.operator)
    ) {
      continue;
    }

    const wallet = approvalForAll.account;
    const record = dependencies.stateStore.getTrackedWallet(wallet);

    if (!record || record.firstUse) {
      continue;
    }

    const timestamp = await dependencies.polygonClient.getBlockTimestamp(
      approvalForAll.blockNumber
    );

    if (timestamp < record.firstFunding.timestamp) {
      continue;
    }

    const alert = await registerFirstUse(dependencies, wallet, {
      kind: "CTF approval for exchange",
      contract: approvalForAll.operator,
      transactionHash: approvalForAll.transactionHash,
      blockNumber: approvalForAll.blockNumber,
      timestamp
    });

    if (alert) {
      alerts.push(alert);
    }
  }

  return { alerts };
}
