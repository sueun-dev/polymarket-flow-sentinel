import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getTradeUsdSize } from "../src/polymarket-data-client.js";
import { decodeErc20TransferLog } from "../src/polygon-rpc-client.js";
import { JsonMonitorStateStore } from "../src/json-state-store.js";
import { FundingLifecycleMonitor } from "../src/funding-lifecycle-monitor.js";
import { POLYMARKET_CONTRACTS } from "../src/polymarket-address-book.js";
import { POLYGON_FUNDING_ASSETS } from "../src/polygon-funding-assets.js";

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
    polygonClient: {
      async getBlockNumber() {
        return 42;
      }
    },
    polymarketClient: {},
    priceClient: {
      async getUsdPrice() {
        return 1;
      }
    },
    stateStore,
    config: {
      minFundingUsd: 50_000,
      minTradeUsd: 0,
      pollIntervalMs: 1_000,
      bootstrapMode: "skip",
      startupLookbackBlocks: 50,
      blockBatchSize: 10,
      maxRecentAlerts: 20,
      webhookUrl: ""
    },
    logger: {
      info() {},
      error() {}
    }
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
  const trade = {
    proxyWallet: wallet,
    transactionHash: "0xtrade",
    timestamp: 1_010,
    title: "Will ETH close up?",
    outcome: "Yes",
    side: "BUY",
    slug: "eth-close-up",
    usdcSize: 12_500
  };
  const monitor = new FundingLifecycleMonitor({
    polygonClient: {
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
      async getNativeTransfers() {
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
      async getApprovalForAllLogs() {
        return [];
      },
      async getBlockTimestamp(blockNumber) {
        return 1_000 + blockNumber;
      },
      async getCode() {
        return "0x";
      }
    },
    polymarketClient: {
      firstActivityChecks: 0,
      async getFirstActivity() {
        this.firstActivityChecks += 1;
        return null;
      },
      async getFirstTrade() {
        return trade;
      },
      async getTradeActivitySince() {
        return [trade];
      }
    },
    priceClient: {
      async getUsdPrice(asset) {
        const currentAsset = POLYGON_FUNDING_ASSETS.find((item) => item.address === asset.address);
        assert.ok(currentAsset);
        return 1;
      }
    },
    stateStore,
    config: {
      minFundingUsd: 50_000,
      minTradeUsd: 0,
      pollIntervalMs: 1_000,
      bootstrapMode: "scan",
      startupLookbackBlocks: 5,
      blockBatchSize: 10,
      maxRecentAlerts: 20,
      webhookUrl: ""
    },
    logger: {
      info() {},
      error() {}
    }
  });

  await monitor.initialize();
  const result = await monitor.runOnce();
  const trackedWallet = stateStore.getTrackedWallet(wallet);

  assert.equal(result.alerts.length, 3);
  assert.equal(trackedWallet.totalFundedUsd, 60_000);
  assert.equal(trackedWallet.firstUse.kind, "USDC approval to CTF");
  assert.equal(trackedWallet.firstTrade.usdSize, 12_500);
  assert.equal(trackedWallet.status, "first-trade");

  await fs.unlink(filePath);
});
