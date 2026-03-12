import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FundingLifecycleMonitor } from "../src/funding-lifecycle-monitor.js";
import { JsonMonitorStateStore } from "../src/json-state-store.js";
import { POLYMARKET_CONTRACTS } from "../src/polymarket-address-book.js";
import { getTradeUsdSize } from "../src/polymarket-data-client.js";
import { POLYGON_FUNDING_ASSETS } from "../src/polygon-funding-assets.js";
import { decodeErc20TransferLog } from "../src/polygon-rpc-client.js";

import type {
  AssetPriceClientLike,
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
    stateFile: path.join(os.tmpdir(), `flow-sentinel-config-${process.pid}.json`),
    webhookUrl: "",
    bootstrapMode: "scan",
    host: "127.0.0.1",
    port: 3001,
    ...overrides
  };
}

function createPolygonClientStub(
  overrides: Partial<PolygonClientLike> = {}
): PolygonClientLike {
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
    ...overrides
  };
}

function createPolymarketClientStub(
  overrides: Partial<PolymarketDataClientLike> = {}
): PolymarketDataClientLike {
  return {
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

function createPriceClientStub(overrides: Partial<AssetPriceClientLike> = {}): AssetPriceClientLike {
  return {
    async getUsdPrice() {
      return 1;
    },
    ...overrides
  };
}

test("getTradeUsdSize prefers explicit usdcSize", () => {
  assert.equal(
    getTradeUsdSize({
      usdcSize: 50_001,
      size: 100_000,
      price: 0.1
    }),
    50_001
  );
});

test("getTradeUsdSize falls back to size times price", () => {
  assert.equal(
    getTradeUsdSize({
      size: 100_000,
      price: 0.51
    }),
    51_000
  );
});

test("decodeErc20TransferLog decodes addresses, amount, and position", () => {
  const log = {
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x0000000000000000000000001111111111111111111111111111111111111111",
      "0x0000000000000000000000002222222222222222222222222222222222222222"
    ],
    data: "0x0000000000000000000000000000000000000000000000000000000000c350",
    transactionHash: "0xtx",
    blockNumber: "0xa",
    logIndex: "0x3"
  };

  assert.deepEqual(decodeErc20TransferLog(log), {
    type: "transfer",
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    valueRaw: 50_000n,
    value: 0.05,
    transactionHash: "0xtx",
    blockNumber: 10,
    logIndex: 3
  });
});

test("FundingLifecycleMonitor bootstraps to the latest block in skip mode", async () => {
  const filePath = path.join(os.tmpdir(), `polymarket-flow-sentinel-bootstrap-${process.pid}-${Date.now()}.json`);
  const stateStore = new JsonMonitorStateStore(filePath, 100, 100, 100);
  const monitor = new FundingLifecycleMonitor({
    polygonClient: createPolygonClientStub({
      async getBlockNumber() {
        return 42;
      }
    }),
    polymarketClient: createPolymarketClientStub(),
    priceClient: createPriceClientStub(),
    stateStore,
    config: createTestConfig({
      bootstrapMode: "skip"
    }),
    logger: createLogger()
  });

  await monitor.initialize();
  const result = await monitor.runOnce();

  assert.equal(result.bootstrapped, true);
  assert.equal(result.lastProcessedBlock, 42);
  assert.equal(stateStore.getLastProcessedBlock(), 42);

  await fs.unlink(filePath);
});

test("FundingLifecycleMonitor records funding, first use, and first trade", async () => {
  const filePath = path.join(os.tmpdir(), `polymarket-flow-sentinel-lifecycle-${process.pid}-${Date.now()}.json`);
  const stateStore = new JsonMonitorStateStore(filePath, 100, 100, 100);
  const wallet = "0x2222222222222222222222222222222222222222";
  const trade: PolymarketActivityRow = {
    proxyWallet: wallet,
    transactionHash: "0xtrade",
    timestamp: 1_010,
    title: "Will ETH close up?",
    outcome: "Yes",
    side: "BUY",
    slug: "eth-close-up",
    usdcSize: 12_500
  };
  let firstActivityChecks = 0;
  const monitor = new FundingLifecycleMonitor({
    polygonClient: createPolygonClientStub({
      async getBlockNumber() {
        return 10;
      },
      async getErc20TransferLogs({ fromBlock, toBlock, address }) {
        assert.equal(fromBlock, 6);
        assert.equal(toBlock, 10);

        if (address === POLYMARKET_CONTRACTS.usdc) {
          return [
            {
              type: "transfer",
              from: "0x1111111111111111111111111111111111111111",
              to: wallet,
              valueRaw: 60_000_000_000n,
              value: 60_000,
              transactionHash: "0xfund",
              blockNumber: 8,
              logIndex: 1
            }
          ];
        }

        return [];
      },
      async getUsdcApprovalLogs() {
        return [
          {
            type: "approval",
            owner: wallet,
            spender: POLYMARKET_CONTRACTS.conditionalTokens.toLowerCase(),
            valueRaw: 1n,
            value: 0.000001,
            transactionHash: "0xapprove",
            blockNumber: 9,
            logIndex: 2
          }
        ];
      },
      async getBlockTimestamp(blockNumber: number) {
        return 1_000 + blockNumber;
      }
    }),
    polymarketClient: createPolymarketClientStub({
      async getFirstActivity() {
        firstActivityChecks += 1;
        return null;
      },
      async getFirstTrade() {
        return trade;
      },
      async getTradeActivitySince() {
        return [trade];
      }
    }),
    priceClient: createPriceClientStub({
      async getUsdPrice(asset) {
        const currentAsset = POLYGON_FUNDING_ASSETS.find((item) => item.address === asset.address);
        assert.ok(currentAsset);
        return 1;
      }
    }),
    stateStore,
    config: createTestConfig({
      bootstrapMode: "scan",
      startupLookbackBlocks: 5
    }),
    logger: createLogger()
  });

  await monitor.initialize();
  const result = await monitor.runOnce();
  const trackedWallet = stateStore.getTrackedWallet(wallet);

  assert.equal(firstActivityChecks, 1);
  assert.equal(result.alerts.length, 3);
  assert.ok(trackedWallet);
  assert.equal(trackedWallet.totalFundedUsd, 60_000);
  assert.equal(trackedWallet.firstUse?.kind, "USDC approval to CTF");
  assert.equal(trackedWallet.firstTrade?.usdSize, 12_500);
  assert.equal(trackedWallet.status, "first-trade");

  await fs.unlink(filePath);
});
