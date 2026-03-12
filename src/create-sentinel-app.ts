import { AssetPriceClient } from "./asset-price-client.js";
import { loadConfig } from "./config.js";
import { FundingLifecycleMonitor } from "./funding-lifecycle-monitor.js";
import { JsonMonitorStateStore } from "./json-state-store.js";
import { MonitorRuntime } from "./monitor-runtime.js";
import { PolygonRpcClient } from "./polygon-rpc-client.js";
import { PolymarketDataClient } from "./polymarket-data-client.js";

import type { CreateAppResult } from "./types.js";

export function createFlowSentinelApp(argv: string[] = process.argv.slice(2)): CreateAppResult {
  const config = loadConfig(argv);
  const polygonRpcClient = new PolygonRpcClient({
    rpcUrl: config.polygonRpcUrl,
    timeoutMs: config.requestTimeoutMs
  });
  const polymarketDataClient = new PolymarketDataClient({
    baseUrl: config.dataApiBaseUrl,
    timeoutMs: config.requestTimeoutMs,
    activityPageSize: config.activityPageSize,
    activityPageCount: config.activityPageCount
  });
  const assetPriceClient = new AssetPriceClient({
    timeoutMs: config.requestTimeoutMs,
    cacheMs: config.priceCacheMs
  });
  const stateStore = new JsonMonitorStateStore(
    config.stateFile,
    config.maxSeenFundingTransfers,
    config.maxSentEventKeys,
    config.maxTrackedWallets
  );
  const monitor = new FundingLifecycleMonitor({
    polygonClient: polygonRpcClient,
    polymarketClient: polymarketDataClient,
    priceClient: assetPriceClient,
    stateStore,
    config
  });
  const runtime = new MonitorRuntime({ monitor, stateStore, config });

  return {
    config,
    polygonRpcClient,
    polymarketDataClient,
    assetPriceClient,
    stateStore,
    monitor,
    runtime
  };
}
