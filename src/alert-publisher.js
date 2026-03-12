function shortWallet(wallet) {
  if (!wallet || wallet.length < 10) {
    return wallet;
  }

  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

export function formatUsd(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(amount ?? 0);
}

export function formatMonitorAlertMessage(alert) {
  if (alert.stage === "funding") {
    return [
      `[FRESH WALLET FUNDED] ${formatUsd(alert.amountUsd)}`,
      `Wallet: ${shortWallet(alert.wallet)}`,
      `Wallet type: ${alert.walletKind ?? "Unknown"}`,
      `Asset: ${alert.amountToken?.toLocaleString?.() ?? alert.amountToken ?? "-"} ${alert.assetSymbol ?? ""}`.trim(),
      `Source: ${shortWallet(alert.from)}`,
      alert.transactionHash ? `Tx: https://polygonscan.com/tx/${alert.transactionHash}` : null
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (alert.stage === "first-use") {
    return [
      `[POLYMARKET FIRST USE] ${alert.useKind}`,
      `Wallet: ${shortWallet(alert.wallet)}`,
      `Funding tracked: ${formatUsd(alert.fundedUsd)}`,
      alert.transactionHash ? `Tx: https://polygonscan.com/tx/${alert.transactionHash}` : null
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `[POLYMARKET FIRST TRADE] ${formatUsd(alert.tradeUsd)}`,
    `Wallet: ${shortWallet(alert.wallet)}`,
    `Market: ${alert.title ?? "Unknown market"}`,
    `Outcome: ${alert.outcome ?? "-"}`,
    `Side: ${alert.side ?? "-"}`,
    `Tracked funding: ${formatUsd(alert.fundedUsd)}`,
    `Observed trade volume since funding: ${formatUsd(alert.observedTradeUsd)}`,
    alert.transactionHash ? `Tx: https://polygonscan.com/tx/${alert.transactionHash}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

export async function publishWebhookAlert(webhookUrl, payload, fetchImpl = fetch) {
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
