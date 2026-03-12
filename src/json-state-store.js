import fs from "node:fs/promises";
import path from "node:path";

const EMPTY_STATE = Object.freeze({
  bootstrapped: false,
  lastProcessedBlock: null,
  seenFundingTransferKeys: [],
  sentEventKeys: [],
  trackedWallets: {},
  recentAlerts: [],
  monitorStatus: {
    lastChainSync: null
  }
});

function sanitizeObjectRecord(value) {
  return value && typeof value === "object" ? value : {};
}

export class JsonMonitorStateStore {
  constructor(filePath, maxSeenFundingTransfers, maxSentEventKeys, maxTrackedWallets) {
    this.filePath = filePath;
    this.maxSeenFundingTransfers = maxSeenFundingTransfers;
    this.maxSentEventKeys = maxSentEventKeys;
    this.maxTrackedWallets = maxTrackedWallets;
    this.state = structuredClone(EMPTY_STATE);
    this.seenFundingTransferKeySet = new Set();
    this.sentEventKeySet = new Set();
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const trimmed = raw.trim();

      if (trimmed === "") {
        return;
      }

      const parsed = JSON.parse(trimmed);

      this.state = {
        bootstrapped: Boolean(parsed.bootstrapped),
        lastProcessedBlock: Number.isInteger(parsed.lastProcessedBlock) ? parsed.lastProcessedBlock : null,
        seenFundingTransferKeys: Array.isArray(parsed.seenFundingTransferKeys)
          ? parsed.seenFundingTransferKeys.slice(-this.maxSeenFundingTransfers)
          : [],
        sentEventKeys: Array.isArray(parsed.sentEventKeys) ? parsed.sentEventKeys.slice(-this.maxSentEventKeys) : [],
        trackedWallets: sanitizeObjectRecord(parsed.trackedWallets),
        recentAlerts: Array.isArray(parsed.recentAlerts) ? parsed.recentAlerts : [],
        monitorStatus:
          parsed.monitorStatus && typeof parsed.monitorStatus === "object"
            ? parsed.monitorStatus
            : parsed.trackerStatus && typeof parsed.trackerStatus === "object"
              ? parsed.trackerStatus
              : {}
      };
      this.seenFundingTransferKeySet = new Set(this.state.seenFundingTransferKeys);
      this.sentEventKeySet = new Set(this.state.sentEventKeys);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  setBootstrapped(value) {
    this.state.bootstrapped = Boolean(value);
  }

  isBootstrapped() {
    return this.state.bootstrapped;
  }

  getLastProcessedBlock() {
    return this.state.lastProcessedBlock;
  }

  setLastProcessedBlock(blockNumber) {
    this.state.lastProcessedBlock = blockNumber;
  }

  hasSeenFundingTransfer(key) {
    return this.seenFundingTransferKeySet.has(key);
  }

  markFundingTransferSeen(key) {
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

  hasSentEvent(key) {
    return this.sentEventKeySet.has(key);
  }

  markEventSent(key) {
    if (this.sentEventKeySet.has(key)) {
      return;
    }

    this.sentEventKeySet.add(key);
    this.state.sentEventKeys.push(key);

    if (this.state.sentEventKeys.length > this.maxSentEventKeys) {
      const overflow = this.state.sentEventKeys.splice(0, this.state.sentEventKeys.length - this.maxSentEventKeys);

      for (const item of overflow) {
        this.sentEventKeySet.delete(item);
      }
    }
  }

  getTrackedWallet(wallet) {
    return this.state.trackedWallets[wallet.toLowerCase()] ?? null;
  }

  upsertTrackedWallet(wallet, updater) {
    const key = wallet.toLowerCase();
    const currentValue = this.state.trackedWallets[key] ?? null;
    const nextValue = updater(currentValue);

    if (!nextValue) {
      return null;
    }

    this.state.trackedWallets[key] = nextValue;

    const wallets = Object.values(this.state.trackedWallets);
    if (wallets.length > this.maxTrackedWallets) {
      const overflowWallets = wallets
        .sort((left, right) => {
          const leftTimestamp = left.firstTrade?.timestamp ?? left.firstFunding?.timestamp ?? 0;
          const rightTimestamp = right.firstTrade?.timestamp ?? right.firstFunding?.timestamp ?? 0;
          return leftTimestamp - rightTimestamp;
        })
        .slice(0, wallets.length - this.maxTrackedWallets);

      for (const record of overflowWallets) {
        delete this.state.trackedWallets[record.wallet.toLowerCase()];
      }
    }

    return nextValue;
  }

  listTrackedWallets() {
    return Object.values(this.state.trackedWallets).sort((left, right) => {
      const leftTimestamp = left.firstFunding?.timestamp ?? 0;
      const rightTimestamp = right.firstFunding?.timestamp ?? 0;
      return rightTimestamp - leftTimestamp;
    });
  }

  addRecentAlert(alert, maxRecentAlerts) {
    this.state.recentAlerts.unshift(alert);
    this.state.recentAlerts = this.state.recentAlerts.slice(0, maxRecentAlerts);
  }

  getRecentAlerts(limit = this.state.recentAlerts.length) {
    return this.state.recentAlerts.slice(0, limit);
  }

  getTrackedWalletStats() {
    const wallets = this.listTrackedWallets();
    let firstUseCount = 0;
    let firstTradeCount = 0;

    for (const wallet of wallets) {
      if (wallet.firstUse) {
        firstUseCount += 1;
      }

      if (wallet.firstTrade) {
        firstTradeCount += 1;
      }
    }

    return {
      trackedWalletCount: wallets.length,
      firstUseCount,
      firstTradeCount
    };
  }

  recordMonitorSync(status) {
    this.state.monitorStatus.lastChainSync = status;
  }

  getMonitorStatus() {
    return structuredClone(this.state.monitorStatus);
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempFile = `${this.filePath}.tmp`;
    const payload = JSON.stringify(this.state, null, 2);

    await fs.writeFile(tempFile, payload, "utf8");
    await fs.rename(tempFile, this.filePath);
  }
}
