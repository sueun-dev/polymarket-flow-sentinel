import { EventEmitter } from "node:events";

import type {
  FailedPollSummary,
  LoggerLike,
  MonitorConfig,
  MonitorLastResult,
  MonitorRunResult,
  MonitorSnapshot,
  MonitorStateStoreLike,
  PublishedMonitorAlert,
  SuccessfulPollSummary
} from "./types.js";

interface RuntimeMonitor {
  initialize(): Promise<void>;
  runOnce(): Promise<MonitorRunResult>;
}

interface MonitorRuntimeOptions {
  monitor: RuntimeMonitor;
  stateStore: MonitorStateStoreLike;
  config: MonitorConfig;
  logger?: LoggerLike;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class MonitorRuntime extends EventEmitter {
  private readonly monitor: RuntimeMonitor;
  private readonly stateStore: MonitorStateStoreLike;
  private readonly config: MonitorConfig;
  private readonly logger: LoggerLike;
  private running = false;
  private polling = false;
  private lastPollAt: string | null = null;
  private lastSuccessfulPollAt: string | null = null;
  private lastError: string | null = null;
  private lastResult: MonitorLastResult = null;
  private timer: NodeJS.Timeout | null = null;
  private currentPoll: Promise<MonitorRunResult> | null = null;

  constructor({
    monitor,
    stateStore,
    config,
    logger = console as LoggerLike
  }: MonitorRuntimeOptions) {
    super();
    this.monitor = monitor;
    this.stateStore = stateStore;
    this.config = config;
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    await this.monitor.initialize();
    this.emitSnapshot();
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.emitSnapshot();
    void this.scanNow("startup").catch(() => {});
  }

  stop(): void {
    this.running = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.emitSnapshot();
  }

  async scanNow(reason = "manual"): Promise<MonitorRunResult> {
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

  private async runPoll(reason: string): Promise<MonitorRunResult> {
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
      } satisfies SuccessfulPollSummary;

      for (const alert of result.alerts) {
        this.emit("alert", alert);
      }

      this.emitSnapshot();
      return result;
    } catch (error: unknown) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.lastResult = {
        reason,
        completedAt: nowIso(),
        error: this.lastError
      } satisfies FailedPollSummary;
      this.logger.error(`Runtime poll failed: ${this.lastError}`);
      this.emitSnapshot();
      throw error;
    } finally {
      this.polling = false;
      this.emitSnapshot();
    }
  }

  private scheduleNextPoll(): void {
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

  getSnapshot(): MonitorSnapshot {
    const recentAlerts = this.stateStore.getRecentAlerts(this.config.maxRecentAlerts);
    const monitorStatus = this.stateStore.getMonitorStatus();
    const walletStats = this.stateStore.getTrackedWalletStats();
    const watchlist = this.stateStore.listTrackedWallets();

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
        lastChainSync: monitorStatus.lastChainSync
      },
      stats: {
        trackedWalletCount: walletStats.trackedWalletCount,
        firstUseCount: walletStats.firstUseCount,
        firstTradeCount: walletStats.firstTradeCount,
        depositCount: walletStats.depositCount,
        activeCount: walletStats.activeCount,
        depletedCount: walletStats.depletedCount,
        recentAlertCount: recentAlerts.length,
        lastAlertAt: recentAlerts[0]?.triggeredAt ?? null
      },
      watchlist,
      alerts: recentAlerts
    };
  }

  private emitSnapshot(): void {
    this.emit("snapshot", this.getSnapshot());
  }

  override emit(eventName: "snapshot", snapshot: MonitorSnapshot): boolean;
  override emit(eventName: "alert", alert: PublishedMonitorAlert): boolean;
  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    return super.emit(eventName, ...args);
  }
}
