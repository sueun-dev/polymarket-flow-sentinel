import type { FetchLike, PendingMonitorAlert, PublishedMonitorAlert } from "./types.js";

function shortWallet(wallet: string): string {
  if (wallet.length < 10) {
    return wallet;
  }

  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(amount);
}

export function formatMonitorAlertMessage(alert: PendingMonitorAlert): string {
  if (alert.stage === "funding") {
    return [
      `[FRESH WALLET FUNDED] ${formatUsd(alert.amountUsd)}`,
      `Wallet: ${shortWallet(alert.wallet)}`,
      `Wallet type: ${alert.walletKind}`,
      `Asset: ${alert.amountToken.toLocaleString()} ${alert.assetSymbol}`.trim(),
      `Source: ${shortWallet(alert.from)}`,
      `Tx: https://polygonscan.com/tx/${alert.transactionHash}`
    ].join("\n");
  }

  if (alert.stage === "first-use") {
    return [
      `[POLYMARKET FIRST USE] ${alert.useKind}`,
      `Wallet: ${shortWallet(alert.wallet)}`,
      `Funding tracked: ${formatUsd(alert.fundedUsd)}`,
      alert.transactionHash ? `Tx: https://polygonscan.com/tx/${alert.transactionHash}` : null
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  return [
    `[POLYMARKET FIRST TRADE] ${formatUsd(alert.tradeUsd)}`,
    `Wallet: ${shortWallet(alert.wallet)}`,
    `Market: ${alert.title}`,
    `Outcome: ${alert.outcome || "-"}`,
    `Side: ${alert.side || "-"}`,
    `Tracked funding: ${formatUsd(alert.fundedUsd)}`,
    `Observed trade volume since funding: ${formatUsd(alert.observedTradeUsd)}`,
    `Tx: https://polygonscan.com/tx/${alert.transactionHash}`
  ].join("\n");
}

export async function publishWebhookAlert(
  webhookUrl: string,
  payload: PublishedMonitorAlert,
  fetchImpl: FetchLike = fetch
): Promise<void> {
  if (!webhookUrl) {
    return;
  }

  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      text: payload.message,
      content: payload.message,
      ...payload
    })
  });

  if (!response.ok) {
    throw new Error(`Webhook failed with HTTP ${response.status}.`);
  }
}
