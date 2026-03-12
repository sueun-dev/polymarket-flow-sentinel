import { EventEmitter } from "node:events";

function nowIso() {
  return new Date().toISOString();
}

export class MonitorRuntime extends EventEmitter {
  constructor({ monitor, stateStore, config, logger = console }) {
    super();
    this.monitor = monitor;
    this.stateStore = stateStore;
    this.config = config;
    this.logger = logger;
    this.running = false;
    this.polling = false;
    this.lastPollAt = null;
    this.lastSuccessfulPollAt = null;
    this.lastError = null;
    this.lastResult = null;
    this.timer = null;
    this.currentPoll = null;
  }

  async initialize() {
    await this.monitor.initialize();
    this.emitSnapshot();
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.emitSnapshot();
    void this.scanNow("startup").catch(() => {});
  }

  stop() {
    this.running = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.emitSnapshot();
  }

  async scanNow(reason = "manual") {
    if (this.currentPoll) {
      return this.currentPoll;
    }

    this.currentPoll = this.runPoll(reason).finally(() => {
      this.currentPoll = null;

      if (this.running) {
        this.scheduleNextPoll();
      }
    });

    return this.currentPoll;
  }

  async runPoll(reason) {
    this.polling = true;
    this.lastPollAt = nowIso();
    this.emitSnapshot();

    try {
      const result = await this.monitor.runOnce();

      this.lastSuccessfulPollAt = nowIso();
      this.lastError = null;
      this.lastResult = {
        reason,
        completedAt: this.lastSuccessfulPollAt,
        alertCount: result.alerts.length,
        processedBlocks: result.processedBlocks,
        latestBlock: result.latestBlock,
        lastProcessedBlock: result.lastProcessedBlock,
        newTrackedWallets: result.newTrackedWallets,
        checkedWallets: result.checkedWallets,
        bootstrapped: result.bootstrapped
      };

      for (const alert of result.alerts) {
        this.emit("alert", alert);
      }

      this.emitSnapshot();
      return result;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.lastResult = {
        reason,
        completedAt: nowIso(),
        error: this.lastError
      };
      this.logger.error(`Runtime poll failed: ${this.lastError}`);
      this.emitSnapshot();
      throw error;
    } finally {
      this.polling = false;
      this.emitSnapshot();
    }
  }

  scheduleNextPoll() {
    if (!this.running) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      void this.scanNow("interval").catch(() => {});
    }, this.config.pollIntervalMs);
  }

  getSnapshot() {
    const recentAlerts = this.stateStore.getRecentAlerts(this.config.maxRecentAlerts);
    const monitorStatus = this.stateStore.getMonitorStatus();
    const walletStats = this.stateStore.getTrackedWalletStats();
    const watchlist = this.stateStore.listTrackedWallets().slice(0, 50);

    return {
      monitor: {
        running: this.running,
        polling: this.polling,
        bootstrapped: this.stateStore.isBootstrapped(),
        fundingThresholdUsd: this.config.minFundingUsd,
        tradeThresholdUsd: this.config.minTradeUsd,
        pollIntervalMs: this.config.pollIntervalMs,
        bootstrapMode: this.config.bootstrapMode,
        polygonRpcUrl: this.config.polygonRpcUrl,
        webhookConfigured: Boolean(this.config.webhookUrl),
        lastPollAt: this.lastPollAt,
        lastSuccessfulPollAt: this.lastSuccessfulPollAt,
        lastError: this.lastError,
        lastResult: this.lastResult,
        lastChainSync: monitorStatus.lastChainSync ?? null
      },
      stats: {
        trackedWalletCount: walletStats.trackedWalletCount,
        firstUseCount: walletStats.firstUseCount,
        firstTradeCount: walletStats.firstTradeCount,
        recentAlertCount: recentAlerts.length,
        lastAlertAt: recentAlerts[0]?.triggeredAt ?? null
      },
      watchlist,
      alerts: recentAlerts
    };
  }

  emitSnapshot() {
    this.emit("snapshot", this.getSnapshot());
  }
}
