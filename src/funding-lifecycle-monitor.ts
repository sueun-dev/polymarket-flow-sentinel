import { formatMonitorAlertMessage, publishWebhookAlert } from "./alert-publisher.js";
import { processDepositSignals } from "./monitor/deposit-stage.js";
import { processFundingTransfers } from "./monitor/funding-stage.js";
import { processOnChainUseSignals } from "./monitor/first-use-stage.js";
import { refreshTrackedWallets } from "./monitor/first-trade-stage.js";
import { createEventKey } from "./monitor/shared.js";

import type { MonitorStageContext, MonitorStageDependencies } from "./monitor/shared.js";
import type {
  AssetPriceClientLike,
  FetchLike,
  LoggerLike,
  MonitorConfig,
  MonitorRunResult,
  MonitorStateStoreLike,
  PendingMonitorAlert,
  PolygonClientLike,
  PolymarketDataClientLike,
  PublishedMonitorAlert
} from "./types.js";

interface FundingLifecycleMonitorOptions {
  polygonClient: PolygonClientLike;
  polymarketClient: PolymarketDataClientLike;
  priceClient: AssetPriceClientLike;
  stateStore: MonitorStateStoreLike;
  config: MonitorConfig;
  logger?: LoggerLike;
  fetchImpl?: FetchLike;
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

  private getStageContext(): MonitorStageContext {
    return {
      polygonClient: this.polygonClient,
      polymarketClient: this.polymarketClient,
      priceClient: this.priceClient,
      stateStore: this.stateStore,
      config: this.config,
      logger: this.logger
    };
  }

  private getStageDependencies(): MonitorStageDependencies {
    return {
      ...this.getStageContext(),
      emitAlert: (alert) => this.emitAlert(alert)
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
      this.logger.info(
        `Bootstrapped at Polygon block ${latestBlock}. New funding alerts start on the next poll.`
      );
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

    const stageDependencies = this.getStageDependencies();
    let nextBlock =
      previousBlock === null
        ? Math.max(0, latestBlock - this.config.startupLookbackBlocks + 1)
        : previousBlock + 1;

    let processedBlocks = 0;
    const alerts: PublishedMonitorAlert[] = [];
    let newTrackedWallets = 0;

    while (nextBlock <= latestBlock) {
      const toBlock = Math.min(nextBlock + this.config.blockBatchSize - 1, latestBlock);
      const fundingResult = await processFundingTransfers(stageDependencies, nextBlock, toBlock);
      const chainUseResult = await processOnChainUseSignals(stageDependencies, nextBlock, toBlock);
      const depositResult = await processDepositSignals(stageDependencies, nextBlock, toBlock);

      alerts.push(...fundingResult.alerts, ...chainUseResult.alerts, ...depositResult.alerts);
      newTrackedWallets += fundingResult.newTrackedWallets;
      processedBlocks += toBlock - nextBlock + 1;
      this.stateStore.setLastProcessedBlock(toBlock);
      this.stateStore.setBootstrapped(true);
      nextBlock = toBlock + 1;
    }

    const walletRefreshResult = await refreshTrackedWallets(stageDependencies);
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
