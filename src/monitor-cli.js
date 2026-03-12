import { createFlowSentinelApp } from "./create-sentinel-app.js";

async function main() {
  const { config, runtime } = createFlowSentinelApp();
  await runtime.initialize();

  if (config.once) {
    const result = await runtime.scanNow("cli-once");

    if (result.alerts.length === 0 && !result.bootstrapped) {
      console.info("One-shot scan completed without new funding-to-bet alerts.");
    }

    return;
  }

  runtime.start();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
