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

/**
 * Treat a USDC.e deposit as the wallet's initial funding record. Deposits are
 * the primary entry point, so the deposited amount doubles as the seed funding.
 */
function depositToFundingRecord(deposit: DepositRecord, wallet: string): FundingRecord {
  return {
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
}

export async function processDepositSignals(
  dependencies: MonitorStageDependencies,
  fromBlock: number,
  toBlock: number
): Promise<{ newTrackedWallets: number; alerts: PublishedMonitorAlert[] }> {
  // Deposit detection looks only at DIRECT ERC-20 USDC `Transfer` logs whose
  // `to` is a Polymarket contract, treating `from` as the depositor.
  //
  // Known limitation (architectural; deliberately not partially implemented):
  // deposits routed through a proxy/relayer or gasless meta-transaction do not
  // surface as a direct USDC transfer from the end user, so they are either
  // missed or attributed to the relay/proxy address rather than the owner. The
  // canonical profile lookup below records the proxy as an alias for trade
  // matching, but it does not re-attribute the deposit itself.
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
          latestTransfer: depositToFundingRecord(deposit, wallet)
        });
        continue;
      }

      // Threshold crossed — carry the accumulated prior sub-threshold deposits
      // forward before clearing the pending accumulator. These prior deposits
      // are real money already sent to Polymarket contracts; dropping them would
      // understate totalDepositedUsdc (and the depleted-status calculation that
      // depends on it). The current deposit is added by the upsert below, so the
      // seed only carries the PRIOR total/count (excluding the current transfer).
      const priorDepositedUsdc = pending?.totalUsd ?? 0;
      const priorDepositCount = pending?.transferCount ?? 0;
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
      const initialFunding = depositToFundingRecord(deposit, wallet);

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
        totalDepositedUsdc: priorDepositedUsdc,
        depositCount: priorDepositCount,
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
