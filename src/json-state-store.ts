import fs from "node:fs/promises";
import path from "node:path";

import { isRecord } from "./runtime-guards.js";

import type {
  ChainSyncStatus,
  MonitorStatusState,
  PendingFundingAccumulator,
  PersistedMonitorState,
  PublishedMonitorAlert,
  TrackedWalletRecord
} from "./types.js";

const EMPTY_STATE: PersistedMonitorState = Object.freeze({
  bootstrapped: false,
  lastProcessedBlock: null,
  seenFundingTransferKeys: [],
  sentEventKeys: [],
  trackedWallets: {},
  pendingFunding: {},
  recentAlerts: [],
  monitorStatus: {
    lastChainSync: null
  }
});

function sanitizeObjectRecord<T>(value: unknown): Record<string, T> {
  if (!isRecord(value)) {
    return {};
  }

  return value as Record<string, T>;
}

function sanitizeTrackedWallet(value: unknown): TrackedWalletRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (!("aliases" in record) || !Array.isArray(record["aliases"])) {
    record["aliases"] = [];
  }
  if (!("totalDepositedUsdc" in record)) {
    record["totalDepositedUsdc"] = 0;
  }
  if (!("depositCount" in record)) {
    record["depositCount"] = 0;
  }
  if (!("firstDeposit" in record)) {
    record["firstDeposit"] = null;
  }
  if (!("latestDeposit" in record)) {
    record["latestDeposit"] = null;
  }
  if (!("positions" in record) || !Array.isArray(record["positions"])) {
    record["positions"] = [];
  }
  if (!("totalBetUsd" in record)) {
    record["totalBetUsd"] = 0;
  }
  if (!("positionCount" in record)) {
    record["positionCount"] = 0;
  }

  return record as unknown as TrackedWalletRecord;
}

function sanitizeAlert(value: unknown): PublishedMonitorAlert | null {
  if (!isRecord(value)) {
    return null;
  }

  return value as unknown as PublishedMonitorAlert;
}

function sanitizeChainSyncStatus(value: unknown): ChainSyncStatus | null {
  if (!isRecord(value)) {
    return null;
  }

  return value as unknown as ChainSyncStatus;
}

function sanitizeMonitorStatus(value: unknown): MonitorStatusState {
  if (!isRecord(value)) {
    return { lastChainSync: null };
  }

  return {
    lastChainSync: sanitizeChainSyncStatus(value["lastChainSync"])
  };
}

export class JsonMonitorStateStore {
  private readonly filePath: string;
  private readonly maxSeenFundingTransfers: number;
  private readonly maxSentEventKeys: number;
  private readonly maxTrackedWallets: number;
  private state: PersistedMonitorState = structuredClone(EMPTY_STATE);
  private readonly seenFundingTransferKeySet = new Set<string>();
  private readonly sentEventKeySet = new Set<string>();

  constructor(
    filePath: string,
    maxSeenFundingTransfers: number,
    maxSentEventKeys: number,
    maxTrackedWallets: number
  ) {
    this.filePath = filePath;
    this.maxSeenFundingTransfers = maxSeenFundingTransfers;
    this.maxSentEventKeys = maxSentEventKeys;
    this.maxTrackedWallets = maxTrackedWallets;
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const trimmed = raw.trim();

      if (!trimmed) {
        return;
      }

      const parsed = JSON.parse(trimmed) as unknown;
      const parsedRecord = sanitizeObjectRecord<unknown>(parsed);
      const trackedWalletEntries = Object.entries(
        sanitizeObjectRecord<unknown>(parsedRecord["trackedWallets"])
      )
        .map(([key, value]) => {
          const wallet = sanitizeTrackedWallet(value);
          return wallet ? ([key, wallet] as const) : null;
        })
        .filter((entry): entry is readonly [string, TrackedWalletRecord] => entry !== null);
      const recentAlerts = (
        Array.isArray(parsedRecord["recentAlerts"]) ? parsedRecord["recentAlerts"] : []
      )
        .map((alert) => sanitizeAlert(alert))
        .filter((alert): alert is PublishedMonitorAlert => alert !== null);

      this.state = {
        bootstrapped: Boolean(parsedRecord["bootstrapped"]),
        lastProcessedBlock: Number.isInteger(parsedRecord["lastProcessedBlock"])
          ? (parsedRecord["lastProcessedBlock"] as number)
          : null,
        seenFundingTransferKeys: Array.isArray(parsedRecord["seenFundingTransferKeys"])
          ? parsedRecord["seenFundingTransferKeys"]
              .filter((value): value is string => typeof value === "string")
              .slice(-this.maxSeenFundingTransfers)
          : [],
        sentEventKeys: Array.isArray(parsedRecord["sentEventKeys"])
          ? parsedRecord["sentEventKeys"]
              .filter((value): value is string => typeof value === "string")
              .slice(-this.maxSentEventKeys)
          : [],
        trackedWallets: Object.fromEntries(trackedWalletEntries),
        pendingFunding: sanitizeObjectRecord<PendingFundingAccumulator>(
          parsedRecord["pendingFunding"]
        ),
        recentAlerts,
        monitorStatus: sanitizeMonitorStatus(
          parsedRecord["monitorStatus"] ?? parsedRecord["trackerStatus"]
        )
      };
      this.seenFundingTransferKeySet.clear();
      this.sentEventKeySet.clear();

      for (const key of this.state.seenFundingTransferKeys) {
        this.seenFundingTransferKeySet.add(key);
      }

      for (const key of this.state.sentEventKeys) {
        this.sentEventKeySet.add(key);
      }
    } catch (error: unknown) {
      if (isRecord(error) && error["code"] === "ENOENT") {
        return;
      }

      throw error;
    }
  }

  setBootstrapped(value: boolean): void {
    this.state.bootstrapped = value;
  }

  isBootstrapped(): boolean {
    return this.state.bootstrapped;
  }

  getLastProcessedBlock(): number | null {
    return this.state.lastProcessedBlock;
  }

  setLastProcessedBlock(blockNumber: number): void {
    this.state.lastProcessedBlock = blockNumber;
  }

  hasSeenFundingTransfer(key: string): boolean {
    return this.seenFundingTransferKeySet.has(key);
  }

  markFundingTransferSeen(key: string): void {
    if (this.seenFundingTransferKeySet.has(key)) {
      return;
    }

    this.seenFundingTransferKeySet.add(key);
    this.state.seenFundingTransferKeys.push(key);

    if (this.state.seenFundingTransferKeys.length > this.maxSeenFundingTransfers) {
      const overflow = this.state.seenFundingTransferKeys.splice(
        0,
        this.state.seenFundingTransferKeys.length - this.maxSeenFundingTransfers
      );

      for (const item of overflow) {
        this.seenFundingTransferKeySet.delete(item);
      }
    }
  }

  hasSentEvent(key: string): boolean {
    return this.sentEventKeySet.has(key);
  }

  markEventSent(key: string): void {
    if (this.sentEventKeySet.has(key)) {
      return;
    }

    this.sentEventKeySet.add(key);
    this.state.sentEventKeys.push(key);

    if (this.state.sentEventKeys.length > this.maxSentEventKeys) {
      const overflow = this.state.sentEventKeys.splice(
        0,
        this.state.sentEventKeys.length - this.maxSentEventKeys
      );

      for (const item of overflow) {
        this.sentEventKeySet.delete(item);
      }
    }
  }

  getTrackedWallet(wallet: string): TrackedWalletRecord | null {
    return this.state.trackedWallets[wallet.toLowerCase()] ?? null;
  }

  upsertTrackedWallet(
    wallet: string,
    updater: (currentValue: TrackedWalletRecord | null) => TrackedWalletRecord | null
  ): TrackedWalletRecord | null {
    const key = wallet.toLowerCase();
    const currentValue = this.state.trackedWallets[key] ?? null;
    const nextValue = updater(currentValue);

    if (!nextValue) {
      return null;
    }

    this.state.trackedWallets[key] = nextValue;

    const wallets = Object.values(this.state.trackedWallets);
    if (wallets.length > this.maxTrackedWallets) {
      const overflowCount = wallets.length - this.maxTrackedWallets;

      // Only evict wallets that have completed their lifecycle (have a first trade)
      // Wallets still in funded/first-use stages are protected from eviction
      const evictable = wallets
        .filter((w) => w.firstTrade !== null)
        .sort((left, right) => {
          const leftTimestamp = left.firstTrade?.timestamp ?? left.firstFunding.timestamp;
          const rightTimestamp = right.firstTrade?.timestamp ?? right.firstFunding.timestamp;
          return leftTimestamp - rightTimestamp;
        });

      const toEvict = evictable.slice(0, overflowCount);
      for (const record of toEvict) {
        delete this.state.trackedWallets[record.wallet.toLowerCase()];
      }
    }

    return nextValue;
  }

  listTrackedWallets(): TrackedWalletRecord[] {
    return Object.values(this.state.trackedWallets).sort(
      (left, right) => right.firstFunding.timestamp - left.firstFunding.timestamp
    );
  }

  getPendingFunding(wallet: string): PendingFundingAccumulator | null {
    return this.state.pendingFunding[wallet.toLowerCase()] ?? null;
  }

  upsertPendingFunding(wallet: string, accumulator: PendingFundingAccumulator): void {
    this.state.pendingFunding[wallet.toLowerCase()] = accumulator;
  }

  removePendingFunding(wallet: string): void {
    delete this.state.pendingFunding[wallet.toLowerCase()];
  }

  addRecentAlert(alert: PublishedMonitorAlert, maxRecentAlerts: number): void {
    this.state.recentAlerts.unshift(alert);
    this.state.recentAlerts = this.state.recentAlerts.slice(0, maxRecentAlerts);
  }

  getRecentAlerts(limit = this.state.recentAlerts.length): PublishedMonitorAlert[] {
    return this.state.recentAlerts.slice(0, limit);
  }

  getTrackedWalletStats(): {
    trackedWalletCount: number;
    firstUseCount: number;
    firstTradeCount: number;
    depositCount: number;
    activeCount: number;
    depletedCount: number;
  } {
    const wallets = this.listTrackedWallets();
    let firstUseCount = 0;
    let firstTradeCount = 0;
    let depositCount = 0;
    let activeCount = 0;
    let depletedCount = 0;

    for (const wallet of wallets) {
      if (wallet.firstUse) {
        firstUseCount += 1;
      }

      if (wallet.firstTrade) {
        firstTradeCount += 1;
      }

      if (wallet.depositCount > 0) {
        depositCount += 1;
      }

      if (wallet.status === "active") {
        activeCount += 1;
      }

      if (wallet.status === "depleted") {
        depletedCount += 1;
      }
    }

    return {
      trackedWalletCount: wallets.length,
      firstUseCount,
      firstTradeCount,
      depositCount,
      activeCount,
      depletedCount
    };
  }

  recordMonitorSync(status: ChainSyncStatus): void {
    this.state.monitorStatus.lastChainSync = status;
  }

  getMonitorStatus(): MonitorStatusState {
    return structuredClone(this.state.monitorStatus);
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempFile = `${this.filePath}.tmp`;
    const payload = JSON.stringify(this.state, null, 2);

    await fs.writeFile(tempFile, payload, "utf8");
    await fs.rename(tempFile, this.filePath);
  }
}
