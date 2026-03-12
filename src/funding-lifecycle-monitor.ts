import { formatMonitorAlertMessage, publishWebhookAlert } from "./alert-publisher.js";
import { POLYMARKET_CONTRACTS, FIRST_USE_CONTRACTS } from "./polymarket-address-book.js";
import { getTradeUsdSize } from "./polymarket-data-client.js";
import { POLYGON_FUNDING_ASSETS } from "./polygon-funding-assets.js";

import type {
  AssetPriceClientLike,
  FetchLike,
  FirstUseRecord,
  FundingRecord,
  LoggerLike,
  MonitorConfig,
  MonitorRunResult,
  MonitorStateStoreLike,
  PendingMonitorAlert,
  PolygonClientLike,
  PolymarketActivityRow,
  PolymarketDataClientLike,
  PricedFundingTransfer,
  PublishedMonitorAlert,
  TrackedWalletRecord,
  WalletKind,
  WalletStatus
} from "./types.js";

interface SortableBlockPosition {
  blockNumber: number;
  logIndex: number;
}

interface FundingRegistrationResult {
  tracked: boolean;
  alert: PublishedMonitorAlert | null;
}

interface TradeSummary {
  count: number;
  usd: number;
}

interface FundingLifecycleMonitorOptions {
  polygonClient: PolygonClientLike;
  polymarketClient: PolymarketDataClientLike;
  priceClient: AssetPriceClientLike;
  stateStore: MonitorStateStoreLike;
  config: MonitorConfig;
  logger?: LoggerLike;
  fetchImpl?: FetchLike;
}

const IGNORED_WALLETS = new Set<string>([
  ...Object.values(POLYMARKET_CONTRACTS).map((address) => address.toLowerCase()),
  "0x0000000000000000000000000000000000000000"
]);

function toIsoFromUnix(timestamp: number): string {
  return new Date(timestamp * 1_000).toISOString();
}

function normalizeAddress(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function sortByBlockAndIndex<T extends SortableBlockPosition>(left: T, right: T): number {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber - right.blockNumber;
  }

  return left.logIndex - right.logIndex;
}

function createFundingTransferKey(transfer: PricedFundingTransfer): string {
  return `${transfer.assetAddress}:${transfer.transactionHash}:${transfer.logIndex}:${normalizeAddress(transfer.to)}`;
}

function createEventKey(stage: PendingMonitorAlert["stage"], wallet: string, uniquePart: string): string {
  return `${normalizeAddress(wallet)}:${stage}:${uniquePart}`;
}

function isEmptyCode(value: string): boolean {
  return /^0x0*$/i.test(value);
}

function deriveWalletStatus(record: Pick<TrackedWalletRecord, "firstUse" | "firstTrade">): WalletStatus {
  if (record.firstTrade) {
    return "first-trade";
  }

  if (record.firstUse) {
    return "first-use";
  }

  return "funded";
}

function summarizeTrades(trades: readonly PolymarketActivityRow[]): TradeSummary {
  return trades.reduce<TradeSummary>(
    (summary, trade) => {
      summary.count += 1;
      summary.usd += getTradeUsdSize(trade);
      return summary;
    },
    { count: 0, usd: 0 }
  );
}

export class FundingLifecycleMonitor {
  private readonly polygonClient: PolygonClientLike;
  private readonly polymarketClient: PolymarketDataClientLike;
  private readonly priceClient: AssetPriceClientLike;
  private readonly stateStore: MonitorStateStoreLike;
  private readonly config: MonitorConfig;
  private readonly logger: LoggerLike;
  private readonly fetchImpl: FetchLike;

  constructor({
    polygonClient,
    polymarketClient,
    priceClient,
    stateStore,
    config,
    logger = console as LoggerLike,
    fetchImpl = fetch
  }: FundingLifecycleMonitorOptions) {
    this.polygonClient = polygonClient;
    this.polymarketClient = polymarketClient;
    this.priceClient = priceClient;
    this.stateStore = stateStore;
    this.config = config;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
  }

  async initialize(): Promise<void> {
    await this.stateStore.load();
  }

  private async emitAlert(alert: PendingMonitorAlert): Promise<PublishedMonitorAlert | null> {
    const eventKey = createEventKey(alert.stage, alert.wallet, alert.uniqueKey);

    if (this.stateStore.hasSentEvent(eventKey)) {
      return null;
    }

    const payload: PublishedMonitorAlert = {
      ...alert,
      message: formatMonitorAlertMessage(alert),
      triggeredAt: new Date().toISOString()
    };

    this.logger.info(payload.message);
    await publishWebhookAlert(this.config.webhookUrl, payload, this.fetchImpl);
    this.stateStore.markEventSent(eventKey);
    this.stateStore.addRecentAlert(payload, this.config.maxRecentAlerts);
    return payload;
  }

  private buildTrackedWalletRecord(wallet: string, funding: FundingRecord, walletKind: WalletKind): TrackedWalletRecord {
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
      lastCheckedAt: null
    };
  }

  private async registerFunding(transfer: PricedFundingTransfer): Promise<FundingRegistrationResult> {
    const fundingTimestamp = await this.polygonClient.getBlockTimestamp(transfer.blockNumber);
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

    const existing = this.stateStore.getTrackedWallet(wallet);

    if (!existing) {
      const firstActivity = await this.polymarketClient.getFirstActivity(wallet);

      if (firstActivity && firstActivity.timestamp < fundingTimestamp) {
        return { tracked: false, alert: null };
      }

      const walletCode = await this.polygonClient.getCode(wallet);
      const walletKind: WalletKind = isEmptyCode(walletCode) ? "EOA" : "Contract";
      const record = this.buildTrackedWalletRecord(wallet, funding, walletKind);
      this.stateStore.upsertTrackedWallet(wallet, () => record);

      const alert = await this.emitAlert({
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

    this.stateStore.upsertTrackedWallet(wallet, (current) => {
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

    const updated = this.stateStore.getTrackedWallet(wallet);
    if (!updated) {
      return { tracked: true, alert: null };
    }

    const alert = await this.emitAlert({
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

  private async registerFirstUse(wallet: string, use: FirstUseRecord): Promise<PublishedMonitorAlert | null> {
    const current = this.stateStore.getTrackedWallet(wallet);

    if (!current || current.firstUse) {
      return null;
    }

    this.stateStore.upsertTrackedWallet(wallet, (record) => {
      if (!record) {
        return null;
      }

      return {
        ...record,
        firstUse: use,
        status: "first-use"
      };
    });

    const updated = this.stateStore.getTrackedWallet(wallet);
    if (!updated) {
      return null;
    }

    return this.emitAlert({
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

  private async registerFirstTrade(
    wallet: string,
    trade: PolymarketActivityRow,
    observedTrades: readonly PolymarketActivityRow[]
  ): Promise<PublishedMonitorAlert | null> {
    const current = this.stateStore.getTrackedWallet(wallet);

    if (!current || current.firstTrade) {
      return null;
    }

    const tradeUsd = getTradeUsdSize(trade);
    const observedSummary = summarizeTrades(observedTrades);
    const firstTrade = {
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

    this.stateStore.upsertTrackedWallet(wallet, (record) => {
      if (!record) {
        return null;
      }

      return {
        ...record,
        firstUse:
          record.firstUse ??
          ({
            kind: "trade-activity",
            timestamp: trade.timestamp,
            transactionHash: trade.transactionHash
          } satisfies FirstUseRecord),
        firstTrade,
        status: "first-trade"
      };
    });

    if (tradeUsd < this.config.minTradeUsd) {
      return null;
    }

    return this.emitAlert({
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

  private async collectFundingTransfers(fromBlock: number, toBlock: number): Promise<PricedFundingTransfer[]> {
    const transfers: PricedFundingTransfer[] = [];

    for (const asset of POLYGON_FUNDING_ASSETS) {
      let usdPrice: number;

      try {
        usdPrice = await this.priceClient.getUsdPrice(asset);
      } catch (error: unknown) {
        this.logger.error(
          `Skipping funding asset ${asset.symbol} for blocks ${fromBlock}-${toBlock}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        continue;
      }

      if (asset.priceKind === "native") {
        const nativeTransfers = await this.polygonClient.getNativeTransfers({ fromBlock, toBlock });

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

      const tokenTransfers = await this.polygonClient.getErc20TransferLogs({
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

  private async processFundingTransfers(
    fromBlock: number,
    toBlock: number
  ): Promise<{ newTrackedWallets: number; alerts: PublishedMonitorAlert[] }> {
    const transfers = await this.collectFundingTransfers(fromBlock, toBlock);
    const sameTransactionSenders = new Set(
      transfers.map((transfer) => `${transfer.transactionHash}:${normalizeAddress(transfer.from)}`)
    );
    const candidateTransfers = transfers
      .filter(
        (transfer) =>
          transfer.value >= this.config.minFundingUsd &&
          !sameTransactionSenders.has(`${transfer.transactionHash}:${normalizeAddress(transfer.to)}`)
      )
      .sort(sortByBlockAndIndex);

    let newTrackedWallets = 0;
    const alerts: PublishedMonitorAlert[] = [];

    for (const transfer of candidateTransfers) {
      const transferKey = createFundingTransferKey(transfer);

      if (this.stateStore.hasSeenFundingTransfer(transferKey)) {
        continue;
      }

      this.stateStore.markFundingTransferSeen(transferKey);
      const result = await this.registerFunding(transfer);

      if (result.tracked) {
        const existing = this.stateStore.getTrackedWallet(transfer.to);

        if (existing?.fundingCount === 1 && existing.firstFunding.transactionHash === transfer.transactionHash) {
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

  private async processOnChainUseSignals(
    fromBlock: number,
    toBlock: number
  ): Promise<{ alerts: PublishedMonitorAlert[] }> {
    const [usdcApprovals, approvalForAllLogs] = await Promise.all([
      this.polygonClient.getUsdcApprovalLogs({
        fromBlock,
        toBlock,
        address: POLYMARKET_CONTRACTS.usdc,
        spender: POLYMARKET_CONTRACTS.conditionalTokens
      }),
      this.polygonClient.getApprovalForAllLogs({
        fromBlock,
        toBlock,
        address: POLYMARKET_CONTRACTS.conditionalTokens
      })
    ]);

    const alerts: PublishedMonitorAlert[] = [];

    for (const approval of usdcApprovals.sort(sortByBlockAndIndex)) {
      if (!FIRST_USE_CONTRACTS.usdcApprovalSpenders.includes(approval.spender) || approval.value <= 0) {
        continue;
      }

      const wallet = approval.owner;
      const record = this.stateStore.getTrackedWallet(wallet);

      if (!record || record.firstUse) {
        continue;
      }

      const timestamp = await this.polygonClient.getBlockTimestamp(approval.blockNumber);

      if (timestamp < record.firstFunding.timestamp) {
        continue;
      }

      const alert = await this.registerFirstUse(wallet, {
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
      const record = this.stateStore.getTrackedWallet(wallet);

      if (!record || record.firstUse) {
        continue;
      }

      const timestamp = await this.polygonClient.getBlockTimestamp(approvalForAll.blockNumber);

      if (timestamp < record.firstFunding.timestamp) {
        continue;
      }

      const alert = await this.registerFirstUse(wallet, {
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

  private async refreshTrackedWallets(): Promise<{ checkedWallets: number; alerts: PublishedMonitorAlert[] }> {
    const trackedWallets = this.stateStore.listTrackedWallets();
    const alerts: PublishedMonitorAlert[] = [];
    let checkedWallets = 0;

    for (const walletRecord of trackedWallets) {
      if (walletRecord.firstTrade) {
        continue;
      }

      checkedWallets += 1;

      const firstTrade = await this.polymarketClient.getFirstTrade(walletRecord.wallet);

      if (firstTrade && firstTrade.timestamp >= walletRecord.firstFunding.timestamp) {
        const observedTrades = await this.polymarketClient.getTradeActivitySince(
          walletRecord.wallet,
          walletRecord.firstFunding.timestamp
        );

        if (!walletRecord.firstUse) {
          const firstUseAlert = await this.registerFirstUse(walletRecord.wallet, {
            kind: "trade-activity",
            transactionHash: firstTrade.transactionHash,
            timestamp: firstTrade.timestamp
          });

          if (firstUseAlert) {
            alerts.push(firstUseAlert);
          }
        }

        const firstTradeAlert = await this.registerFirstTrade(walletRecord.wallet, firstTrade, observedTrades);

        if (firstTradeAlert) {
          alerts.push(firstTradeAlert);
        }
      } else if (!walletRecord.firstUse) {
        const firstActivity = await this.polymarketClient.getFirstActivity(walletRecord.wallet);

        if (firstActivity && firstActivity.timestamp >= walletRecord.firstFunding.timestamp) {
          const firstUseAlert = await this.registerFirstUse(walletRecord.wallet, {
            kind: `activity:${(firstActivity.type ?? "UNKNOWN").toLowerCase()}`,
            transactionHash: firstActivity.transactionHash,
            timestamp: firstActivity.timestamp
          });

          if (firstUseAlert) {
            alerts.push(firstUseAlert);
          }
        }
      }

      this.stateStore.upsertTrackedWallet(walletRecord.wallet, (record) => {
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

  async runOnce(): Promise<MonitorRunResult> {
    const latestBlock = await this.polygonClient.getBlockNumber();
    const previousBlock = this.stateStore.getLastProcessedBlock();

    if (previousBlock === null && this.config.bootstrapMode === "skip") {
      this.stateStore.setLastProcessedBlock(latestBlock);
      this.stateStore.setBootstrapped(true);
      this.stateStore.recordMonitorSync({
        latestBlock,
        lastProcessedBlock: latestBlock,
        lagBlocks: 0,
        checkedAt: new Date().toISOString(),
        bootstrapped: true
      });
      await this.stateStore.save();
      this.logger.info(`Bootstrapped at Polygon block ${latestBlock}. New funding alerts start on the next poll.`);
      return {
        alerts: [],
        bootstrapped: true,
        latestBlock,
        lastProcessedBlock: latestBlock,
        processedBlocks: 0,
        newTrackedWallets: 0,
        checkedWallets: 0
      };
    }

    let nextBlock =
      previousBlock === null
        ? Math.max(0, latestBlock - this.config.startupLookbackBlocks + 1)
        : previousBlock + 1;

    let processedBlocks = 0;
    const alerts: PublishedMonitorAlert[] = [];
    let newTrackedWallets = 0;

    while (nextBlock <= latestBlock) {
      const toBlock = Math.min(nextBlock + this.config.blockBatchSize - 1, latestBlock);
      const fundingResult = await this.processFundingTransfers(nextBlock, toBlock);
      const chainUseResult = await this.processOnChainUseSignals(nextBlock, toBlock);

      alerts.push(...fundingResult.alerts, ...chainUseResult.alerts);
      newTrackedWallets += fundingResult.newTrackedWallets;
      processedBlocks += toBlock - nextBlock + 1;
      this.stateStore.setLastProcessedBlock(toBlock);
      this.stateStore.setBootstrapped(true);
      nextBlock = toBlock + 1;
    }

    const walletRefreshResult = await this.refreshTrackedWallets();
    alerts.push(...walletRefreshResult.alerts);

    const lastProcessedBlock = this.stateStore.getLastProcessedBlock() ?? latestBlock;
    this.stateStore.recordMonitorSync({
      latestBlock,
      lastProcessedBlock,
      lagBlocks: Math.max(0, latestBlock - lastProcessedBlock),
      checkedAt: new Date().toISOString(),
      processedBlocks
    });
    await this.stateStore.save();

    return {
      bootstrapped: previousBlock === null,
      latestBlock,
      lastProcessedBlock,
      processedBlocks,
      newTrackedWallets,
      checkedWallets: walletRefreshResult.checkedWallets,
      alerts
    };
  }
}
