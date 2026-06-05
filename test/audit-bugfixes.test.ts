import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FundingLifecycleMonitor } from "../src/funding-lifecycle-monitor.js";
import { JsonMonitorStateStore } from "../src/json-state-store.js";
import { POLYMARKET_CONTRACTS } from "../src/polymarket-address-book.js";
import { decodeErc20TransferLog } from "../src/polygon-rpc-client.js";

import type {
  AssetPriceClientLike,
  DecodedTransferLog,
  LoggerLike,
  MonitorConfig,
  PolygonClientLike,
  PolymarketActivityRow,
  PolymarketDataClientLike
} from "../src/types.js";

function createLogger(): LoggerLike {
  return {
    info() {},
    error() {}
  };
}

function createTestConfig(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    once: false,
    dataApiBaseUrl: "https://data-api.polymarket.com",
    polygonRpcUrl: "https://polygon.drpc.org",
    minFundingUsd: 50_000,
    minDepositUsd: 10_000,
    minTradeUsd: 0,
    pollIntervalMs: 1_000,
    startupLookbackBlocks: 50,
    blockBatchSize: 10,
    activityPageSize: 500,
    activityPageCount: 10,
    priceCacheMs: 60_000,
    maxTrackedWallets: 100,
    maxSeenFundingTransfers: 100,
    maxSentEventKeys: 100,
    maxRecentAlerts: 20,
    requestTimeoutMs: 5_000,
    refreshConcurrency: 10,
    confirmationBlocks: 0,
    stateFile: path.join(os.tmpdir(), `flow-sentinel-audit-${process.pid}.json`),
    webhookUrl: "",
    bootstrapMode: "scan",
    host: "127.0.0.1",
    port: 3001,
    ...overrides
  };
}

function createPolygonClientStub(overrides: Partial<PolygonClientLike> = {}): PolygonClientLike {
  return {
    async getBlockNumber() {
      return 0;
    },
    async getCode() {
      return "0x";
    },
    async getBlockTimestamp() {
      return 0;
    },
    async getErc20TransferLogs() {
      return [];
    },
    async getNativeTransfers() {
      return [];
    },
    async getUsdcApprovalLogs() {
      return [];
    },
    async getApprovalForAllLogs() {
      return [];
    },
    async getUsdcTransfersToAddresses() {
      return [];
    },
    ...overrides
  };
}

function createPolymarketClientStub(
  overrides: Partial<PolymarketDataClientLike> = {}
): PolymarketDataClientLike {
  return {
    async getCanonicalProfileWallet() {
      return null;
    },
    async getFirstActivity() {
      return null;
    },
    async getFirstTrade() {
      return null;
    },
    async getTradeActivitySince() {
      return [];
    },
    ...overrides
  };
}

function createPriceClientStub(
  overrides: Partial<AssetPriceClientLike> = {}
): AssetPriceClientLike {
  return {
    async getUsdPrice() {
      return 1;
    },
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Finding #5 — BigInt precision in formatUnits
// ---------------------------------------------------------------------------

function transferLog(rawValueHex: string): DecodedTransferLog {
  return decodeErc20TransferLog(
    {
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x0000000000000000000000001111111111111111111111111111111111111111",
        "0x0000000000000000000000002222222222222222222222222222222222222222"
      ],
      data: rawValueHex,
      transactionHash: "0xtx",
      blockNumber: "0xa",
      logIndex: "0x0"
    },
    18
  );
}

test("formatUnits preserves the integer magnitude of an 18-decimal whale amount", () => {
  // 50_000 tokens with 18 decimals = 50_000 * 10**18, far beyond
  // Number.MAX_SAFE_INTEGER. Converting the raw BigInt to Number BEFORE
  // scaling rounds the integer part; scaling via BigInt first does not.
  const raw = 50_000n * 10n ** 18n;
  const decoded = transferLog(`0x${raw.toString(16)}`);

  assert.equal(decoded.valueRaw, raw);
  // The integer part must be exact — no off-by-rounding from float narrowing.
  assert.equal(Math.trunc(decoded.value), 50_000);
  assert.equal(decoded.value, 50_000);
});

test("formatUnits keeps integer and fractional parts for 18-decimal tokens", () => {
  // 1234.5 tokens with 18 decimals.
  const raw = 1_234n * 10n ** 18n + 5n * 10n ** 17n;
  const decoded = transferLog(`0x${raw.toString(16)}`);

  assert.equal(Math.trunc(decoded.value), 1_234);
  assert.ok(Math.abs(decoded.value - 1_234.5) < 1e-6);
});

test("formatUnits still decodes 6-decimal USDC amounts correctly", () => {
  const decoded = decodeErc20TransferLog({
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x0000000000000000000000001111111111111111111111111111111111111111",
      "0x0000000000000000000000002222222222222222222222222222222222222222"
    ],
    data: "0x0000000000000000000000000000000000000000000000000000000000c350",
    transactionHash: "0xtx",
    blockNumber: "0xa",
    logIndex: "0x0"
  });

  assert.equal(decoded.value, 0.05);
});

// ---------------------------------------------------------------------------
// Finding #1 — reorg tolerance: do not process unconfirmed tip blocks
// ---------------------------------------------------------------------------

test("runOnce leaves the most recent confirmationBlocks unprocessed", async () => {
  const filePath = path.join(
    os.tmpdir(),
    `polymarket-flow-sentinel-confirmations-${process.pid}-${Date.now()}.json`
  );
  const stateStore = new JsonMonitorStateStore(filePath, 100, 100, 100);
  const requestedRanges: Array<{ fromBlock: number; toBlock: number }> = [];

  const monitor = new FundingLifecycleMonitor({
    polygonClient: createPolygonClientStub({
      async getBlockNumber() {
        return 100;
      },
      async getUsdcTransfersToAddresses({ fromBlock, toBlock }) {
        requestedRanges.push({ fromBlock, toBlock });
        return [];
      },
      async getBlockTimestamp(blockNumber: number) {
        return 1_000 + blockNumber;
      }
    }),
    polymarketClient: createPolymarketClientStub(),
    priceClient: createPriceClientStub(),
    stateStore,
    config: createTestConfig({
      bootstrapMode: "scan",
      startupLookbackBlocks: 20,
      confirmationBlocks: 12,
      blockBatchSize: 50
    }),
    logger: createLogger()
  });

  await monitor.initialize();
  const result = await monitor.runOnce();

  const confirmedHead = 100 - 12;
  // The cursor must stop at the confirmed head, never the unconfirmed tip (100).
  assert.equal(result.lastProcessedBlock, confirmedHead);
  assert.equal(stateStore.getLastProcessedBlock(), confirmedHead);
  assert.equal(result.latestBlock, 100);

  // No scan request may reach into the unconfirmed tip region (> confirmedHead).
  for (const range of requestedRanges) {
    assert.ok(
      range.toBlock <= confirmedHead,
      `scan range ${range.fromBlock}-${range.toBlock} must not exceed confirmed head ${confirmedHead}`
    );
  }

  await fs.unlink(filePath);
});

test("skip-mode bootstrap parks the cursor at the confirmed head, not the tip", async () => {
  const filePath = path.join(
    os.tmpdir(),
    `polymarket-flow-sentinel-skip-confirm-${process.pid}-${Date.now()}.json`
  );
  const stateStore = new JsonMonitorStateStore(filePath, 100, 100, 100);
  const monitor = new FundingLifecycleMonitor({
    polygonClient: createPolygonClientStub({
      async getBlockNumber() {
        return 100;
      }
    }),
    polymarketClient: createPolymarketClientStub(),
    priceClient: createPriceClientStub(),
    stateStore,
    config: createTestConfig({ bootstrapMode: "skip", confirmationBlocks: 12 }),
    logger: createLogger()
  });

  await monitor.initialize();
  const result = await monitor.runOnce();

  assert.equal(result.bootstrapped, true);
  assert.equal(result.lastProcessedBlock, 88);
  assert.equal(stateStore.getLastProcessedBlock(), 88);

  await fs.unlink(filePath);
});

// ---------------------------------------------------------------------------
// Finding #2 — accumulated sub-threshold deposits carried into the total
// ---------------------------------------------------------------------------

test("threshold crossing carries prior accumulated deposits into totalDepositedUsdc", async () => {
  const filePath = path.join(
    os.tmpdir(),
    `polymarket-flow-sentinel-accumulate-${process.pid}-${Date.now()}.json`
  );
  const stateStore = new JsonMonitorStateStore(filePath, 100, 100, 100);
  const wallet = "0x2222222222222222222222222222222222222222";
  const conditionalTokens = POLYMARKET_CONTRACTS.conditionalTokens.toLowerCase();

  // minDepositUsd = 10_000. Three sub-threshold deposits of 4_000 each, each
  // landing in a distinct block as the chain head advances poll-by-poll. The
  // first two stay pending (4_000, then 8_000). The third crosses the threshold
  // (12_000 cumulative). The final totalDepositedUsdc MUST equal the full 12_000
  // — not just the 4_000 of the crossing transfer.
  function deposit(block: number, hash: string): DecodedTransferLog {
    return {
      type: "transfer",
      from: wallet,
      to: conditionalTokens,
      valueRaw: 4_000_000_000n,
      value: 4_000,
      transactionHash: hash,
      blockNumber: block,
      logIndex: 0
    };
  }

  const depositsByBlock = new Map<number, DecodedTransferLog>([
    [11, deposit(11, "0xd1")],
    [21, deposit(21, "0xd2")],
    [31, deposit(31, "0xd3")]
  ]);

  let head = 15;
  const monitor = new FundingLifecycleMonitor({
    polygonClient: createPolygonClientStub({
      async getBlockNumber() {
        return head;
      },
      async getUsdcTransfersToAddresses({ fromBlock, toBlock }) {
        const matched: DecodedTransferLog[] = [];
        for (const [block, log] of depositsByBlock) {
          if (block >= fromBlock && block <= toBlock) {
            matched.push(log);
          }
        }
        return matched;
      },
      async getBlockTimestamp(blockNumber: number) {
        return 1_000 + blockNumber;
      }
    }),
    polymarketClient: createPolymarketClientStub(),
    priceClient: createPriceClientStub(),
    stateStore,
    config: createTestConfig({
      bootstrapMode: "scan",
      startupLookbackBlocks: 20,
      confirmationBlocks: 0,
      blockBatchSize: 100,
      minDepositUsd: 10_000
    }),
    logger: createLogger()
  });

  await monitor.initialize();

  // Poll 1 (head 15, scans up to 15): first deposit -> pending only.
  head = 15;
  await monitor.runOnce();
  assert.equal(stateStore.getTrackedWallet(wallet), null);
  assert.equal(stateStore.getPendingFunding(wallet)?.totalUsd, 4_000);

  // Poll 2 (head 25, scans 16..25): second deposit -> pending 8_000.
  head = 25;
  await monitor.runOnce();
  assert.equal(stateStore.getTrackedWallet(wallet), null);
  assert.equal(stateStore.getPendingFunding(wallet)?.totalUsd, 8_000);

  // Poll 3 (head 35, scans 26..35): third deposit crosses threshold.
  head = 35;
  await monitor.runOnce();
  const tracked = stateStore.getTrackedWallet(wallet);
  assert.ok(tracked, "wallet should be tracked after crossing threshold");
  assert.equal(
    tracked.totalDepositedUsdc,
    12_000,
    "all three deposits must be counted, not just the crossing transfer"
  );
  assert.equal(tracked.depositCount, 3, "all three deposits must be counted");
  assert.equal(stateStore.getPendingFunding(wallet), null, "pending cleared after registration");

  await fs.unlink(filePath);
});

// ---------------------------------------------------------------------------
// Finding #3 — concurrent refresh must not lose or double position/bet totals.
// This regression guard runs many wallets through refresh at concurrency 10
// with an emitAlert that yields the event loop on every alert (forcing the
// workers to interleave across the await boundary). Each wallet's totals must
// exactly equal the sum of its own trades, with no torn read-modify-write.
// ---------------------------------------------------------------------------

test("concurrent wallet refresh keeps per-wallet bet totals exact under interleaving", async () => {
  const filePath = path.join(
    os.tmpdir(),
    `polymarket-flow-sentinel-concurrency-${process.pid}-${Date.now()}.json`
  );
  const stateStore = new JsonMonitorStateStore(filePath, 1_000, 10_000, 1_000);
  const conditionalTokens = POLYMARKET_CONTRACTS.conditionalTokens.toLowerCase();

  const walletCount = 24;
  const tradesPerWallet = 5;
  const tradeUsd = 1_000;

  function walletAddress(index: number): string {
    return `0x${(index + 1).toString(16).padStart(40, "0")}`;
  }

  // Each wallet deposits enough to be tracked, and has `tradesPerWallet` trades.
  const deposits: DecodedTransferLog[] = [];
  const tradesByWallet = new Map<string, PolymarketActivityRow[]>();
  for (let i = 0; i < walletCount; i += 1) {
    const wallet = walletAddress(i);
    deposits.push({
      type: "transfer",
      from: wallet,
      to: conditionalTokens,
      valueRaw: 60_000_000_000n,
      value: 60_000,
      transactionHash: `0xdep${i}`,
      blockNumber: 5,
      logIndex: i
    });

    const trades: PolymarketActivityRow[] = [];
    for (let t = 0; t < tradesPerWallet; t += 1) {
      trades.push({
        proxyWallet: wallet,
        transactionHash: `0xtrade-${i}-${t}`,
        timestamp: 1_010 + t,
        title: `Market ${t}`,
        outcome: "Yes",
        side: "BUY",
        slug: `market-${i}-${t}`,
        usdcSize: tradeUsd
      });
    }
    tradesByWallet.set(wallet, trades);
  }

  const monitor = new FundingLifecycleMonitor({
    polygonClient: createPolygonClientStub({
      async getBlockNumber() {
        return 10;
      },
      async getUsdcTransfersToAddresses() {
        return deposits;
      },
      async getBlockTimestamp(blockNumber: number) {
        return 1_000 + blockNumber;
      }
    }),
    polymarketClient: createPolymarketClientStub({
      async getFirstTrade(addr: string) {
        return tradesByWallet.get(addr.toLowerCase())?.[0] ?? null;
      },
      async getTradeActivitySince(addr: string) {
        return tradesByWallet.get(addr.toLowerCase()) ?? [];
      }
    }),
    priceClient: createPriceClientStub(),
    stateStore,
    // A webhook URL that yields the event loop for every published alert,
    // maximizing the chance that concurrent refresh workers interleave.
    fetchImpl: (async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
    config: createTestConfig({
      bootstrapMode: "scan",
      startupLookbackBlocks: 5,
      confirmationBlocks: 0,
      minDepositUsd: 10_000,
      refreshConcurrency: 10,
      webhookUrl: "https://example.invalid/webhook"
    }),
    logger: createLogger()
  });

  await monitor.initialize();
  await monitor.runOnce();

  for (let i = 0; i < walletCount; i += 1) {
    const wallet = walletAddress(i);
    const record = stateStore.getTrackedWallet(wallet);
    assert.ok(record, `wallet ${wallet} should be tracked`);
    assert.equal(
      record.positionCount,
      tradesPerWallet,
      `wallet ${wallet} positionCount must equal its own trade count`
    );
    assert.equal(
      record.positions.length,
      tradesPerWallet,
      `wallet ${wallet} positions length must equal its own trade count`
    );
    assert.equal(
      record.totalBetUsd,
      tradesPerWallet * tradeUsd,
      `wallet ${wallet} totalBetUsd must equal the exact sum of its own trades`
    );
  }

  await fs.unlink(filePath);
});
