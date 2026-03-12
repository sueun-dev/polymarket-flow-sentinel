const state = {
  snapshot: null,
  busy: false,
  streamConnected: false
};

const elements = {
  liveDot: document.querySelector("#live-dot"),
  liveLabel: document.querySelector("#live-label"),
  thresholdValue: document.querySelector("#threshold-value"),
  intervalValue: document.querySelector("#interval-value"),
  chainValue: document.querySelector("#chain-value"),
  webhookValue: document.querySelector("#webhook-value"),
  monitorState: document.querySelector("#monitor-state"),
  monitorMeta: document.querySelector("#monitor-meta"),
  trackedWallets: document.querySelector("#tracked-wallets"),
  firstUseHits: document.querySelector("#first-use-hits"),
  firstTradeHits: document.querySelector("#first-trade-hits"),
  lastAlert: document.querySelector("#last-alert"),
  statusGrid: document.querySelector("#status-grid"),
  watchlistList: document.querySelector("#watchlist-list"),
  alertsList: document.querySelector("#alerts-list"),
  scanButton: document.querySelector("#scan-button"),
  toggleButton: document.querySelector("#toggle-button"),
  statusItemTemplate: document.querySelector("#status-item-template"),
  watchCardTemplate: document.querySelector("#watch-card-template"),
  alertCardTemplate: document.querySelector("#alert-card-template")
};

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value ?? 0);
}

function formatDate(value) {
  if (!value) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}

function formatRelative(value) {
  if (!value) {
    return "No timestamp";
  }

  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (Math.abs(seconds) < 60) {
    return formatter.format(-seconds, "second");
  }

  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) {
    return formatter.format(-minutes, "minute");
  }

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return formatter.format(-hours, "hour");
  }

  const days = Math.round(hours / 24);
  return formatter.format(-days, "day");
}

function shortWallet(wallet) {
  if (!wallet) {
    return "-";
  }

  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function setConnectionState(mode, label) {
  elements.liveDot.classList.remove("connected", "error");

  if (mode === "connected") {
    elements.liveDot.classList.add("connected");
  }

  if (mode === "error") {
    elements.liveDot.classList.add("error");
  }

  elements.liveLabel.textContent = label;
}

function renderStatusGrid(snapshot) {
  const sync = snapshot.monitor.lastChainSync;
  const entries = [
    ["Bootstrapped", snapshot.monitor.bootstrapped ? "Yes" : "No"],
    ["Boot Mode", snapshot.monitor.bootstrapMode],
    ["Last Poll", formatDate(snapshot.monitor.lastPollAt)],
    ["Last Success", formatDate(snapshot.monitor.lastSuccessfulPollAt)],
    ["Last Error", snapshot.monitor.lastError ?? "None"],
    ["Latest Polygon Block", sync?.latestBlock?.toLocaleString() ?? "-"],
    ["Last Processed Block", sync?.lastProcessedBlock?.toLocaleString() ?? "-"],
    ["Block Lag", sync ? `${sync.lagBlocks.toLocaleString()} blocks` : "-"],
    ["Processed Blocks", sync?.processedBlocks?.toLocaleString() ?? "-"],
    ["Last Result", snapshot.monitor.lastResult ? `${snapshot.monitor.lastResult.alertCount} new alerts` : "None yet"]
  ];

  elements.statusGrid.replaceChildren(
    ...entries.map(([label, value]) => {
      const node = elements.statusItemTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector(".status-label").textContent = label;
      node.querySelector(".status-value").textContent = value;
      return node;
    })
  );
}

function createLink(href, label) {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  return link;
}

function renderWatchlist(snapshot) {
  if (!snapshot.watchlist.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No fresh large-funding wallets are being tracked yet.";
    elements.watchlistList.replaceChildren(empty);
    return;
  }

  elements.watchlistList.replaceChildren(
    ...snapshot.watchlist.map((wallet) => {
      const card = elements.watchCardTemplate.content.firstElementChild.cloneNode(true);
      card.querySelector(".watch-status").textContent = wallet.status.replace("-", " ").toUpperCase();
      card.querySelector(".watch-wallet").textContent = shortWallet(wallet.wallet);
      card.querySelector(".watch-funded").textContent = formatUsd(wallet.totalFundedUsd);

      const detailRows = [
        ["Type", wallet.walletKind ?? "-"],
        ["First Funding", formatDate(wallet.firstFunding?.timestampIso)],
        [
          "Funding Asset",
          wallet.firstFunding ? `${wallet.firstFunding.amountToken} ${wallet.firstFunding.assetSymbol}` : "-"
        ],
        ["Funding Count", String(wallet.fundingCount ?? 0)],
        ["First Use", wallet.firstUse?.kind ?? "Waiting"],
        ["First Bet", wallet.firstTrade ? formatUsd(wallet.firstTrade.usdSize) : "Waiting"],
        ["Bet Market", wallet.firstTrade?.title ?? "Waiting"],
        [
          "Position",
          wallet.firstTrade ? `${wallet.firstTrade.side ?? "-"} ${wallet.firstTrade.outcome ?? ""}`.trim() : "Waiting"
        ],
        ["Lag to Bet", wallet.firstTrade ? `${wallet.firstTrade.secondsFromFunding}s` : "-"],
        ["Last Checked", formatDate(wallet.lastCheckedAt)]
      ];

      const details = card.querySelector(".watch-details");
      details.replaceChildren(
        ...detailRows.map(([label, value]) => {
          const wrapper = document.createElement("div");
          const dt = document.createElement("dt");
          const dd = document.createElement("dd");
          dt.textContent = label;
          dd.textContent = value;
          wrapper.append(dt, dd);
          return wrapper;
        })
      );

      const links = card.querySelector(".watch-links");
      links.append(createLink(`https://polymarket.com/profile/${wallet.wallet}`, "Wallet profile"));

      if (wallet.firstFunding?.transactionHash) {
        links.append(createLink(`https://polygonscan.com/tx/${wallet.firstFunding.transactionHash}`, "Funding tx"));
      }

      if (wallet.firstTrade?.transactionHash) {
        links.append(createLink(`https://polygonscan.com/tx/${wallet.firstTrade.transactionHash}`, "First trade tx"));
      }

      return card;
    })
  );
}

function renderAlerts(snapshot) {
  if (!snapshot.alerts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No funding-to-bet lifecycle alerts have triggered yet.";
    elements.alertsList.replaceChildren(empty);
    return;
  }

  elements.alertsList.replaceChildren(
    ...snapshot.alerts.map((alert) => {
      const card = elements.alertCardTemplate.content.firstElementChild.cloneNode(true);
      const amount =
        alert.stage === "funding"
          ? alert.amountUsd
          : alert.stage === "first-trade"
            ? alert.tradeUsd
            : alert.fundedUsd;

      card.querySelector(".alert-eyebrow").textContent = alert.stage.replace("-", " ").toUpperCase();
      card.querySelector(".alert-title").textContent =
        alert.stage === "first-trade"
          ? alert.title ?? "First trade"
          : alert.stage === "first-use"
            ? alert.useKind
            : shortWallet(alert.wallet);
      card.querySelector(".alert-amount").textContent = formatUsd(amount);

      const detailRows = [
        ["Wallet", shortWallet(alert.wallet)],
        ["Detected", formatRelative(alert.triggeredAt)],
        ["Funding Total", formatUsd(alert.fundedUsd ?? alert.amountUsd)],
        [
          "Funding Asset",
          alert.stage === "funding" ? `${alert.amountToken} ${alert.assetSymbol ?? ""}`.trim() : alert.assetSymbol ?? "-"
        ],
        ["Tx", alert.transactionHash ? `${alert.transactionHash.slice(0, 10)}...` : "-"]
      ];

      if (alert.stage === "first-trade") {
        detailRows.push(["Observed Trade Volume", formatUsd(alert.observedTradeUsd)]);
        detailRows.push(["Bet Market", alert.title ?? "-"]);
        detailRows.push(["Position", `${alert.side ?? "-"} ${alert.outcome ?? ""}`.trim()]);
      }

      const details = card.querySelector(".alert-details");
      details.replaceChildren(
        ...detailRows.map(([label, value]) => {
          const wrapper = document.createElement("div");
          const dt = document.createElement("dt");
          const dd = document.createElement("dd");
          dt.textContent = label;
          dd.textContent = value;
          wrapper.append(dt, dd);
          return wrapper;
        })
      );

      const links = card.querySelector(".alert-links");
      links.append(createLink(`https://polymarket.com/profile/${alert.wallet}`, "Wallet profile"));

      if (alert.transactionHash) {
        links.append(createLink(`https://polygonscan.com/tx/${alert.transactionHash}`, "Polygon tx"));
      }

      return card;
    })
  );
}

function renderSnapshot(snapshot) {
  state.snapshot = snapshot;

  const monitorState = snapshot.monitor.running ? (snapshot.monitor.polling ? "Polling" : "Armed") : "Paused";
  const chainLag = snapshot.monitor.lastChainSync?.lagBlocks;

  elements.thresholdValue.textContent = formatUsd(snapshot.monitor.fundingThresholdUsd);
  elements.intervalValue.textContent = `${Math.round(snapshot.monitor.pollIntervalMs / 1000)}s`;
  elements.chainValue.textContent = chainLag === undefined || chainLag === null ? "-" : `${chainLag} blocks`;
  elements.webhookValue.textContent = snapshot.monitor.webhookConfigured ? "Enabled" : "Off";
  elements.monitorState.textContent = monitorState;
  elements.monitorMeta.textContent = snapshot.monitor.lastSuccessfulPollAt
    ? `Last successful sweep ${formatRelative(snapshot.monitor.lastSuccessfulPollAt)}.`
    : "Awaiting first completed poll.";
  elements.trackedWallets.textContent = snapshot.stats.trackedWalletCount.toLocaleString();
  elements.firstUseHits.textContent = snapshot.stats.firstUseCount.toLocaleString();
  elements.firstTradeHits.textContent = snapshot.stats.firstTradeCount.toLocaleString();
  elements.lastAlert.textContent = snapshot.stats.lastAlertAt
    ? `Most recent alert ${formatRelative(snapshot.stats.lastAlertAt)}.`
    : "No alerts yet.";
  elements.toggleButton.textContent = snapshot.monitor.running ? "Pause Monitor" : "Resume Monitor";
  elements.toggleButton.disabled = state.busy;
  elements.scanButton.disabled = state.busy || snapshot.monitor.polling;

  renderStatusGrid(snapshot);
  renderWatchlist(snapshot);
  renderAlerts(snapshot);
}

async function fetchSnapshot() {
  const response = await fetch("/api/dashboard");
  if (!response.ok) {
    throw new Error(`Dashboard fetch failed with HTTP ${response.status}`);
  }
  return response.json();
}

async function postAction(path) {
  state.busy = true;
  if (state.snapshot) {
    renderSnapshot(state.snapshot);
  }

  try {
    const response = await fetch(path, {
      method: "POST"
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "Request failed");
    }

    renderSnapshot(payload);
  } finally {
    state.busy = false;
    if (state.snapshot) {
      renderSnapshot(state.snapshot);
    }
  }
}

function connectEventStream() {
  const stream = new EventSource("/api/events");

  stream.addEventListener("open", () => {
    state.streamConnected = true;
    setConnectionState("connected", "Live stream connected");
  });

  stream.addEventListener("snapshot", (event) => {
    renderSnapshot(JSON.parse(event.data));
  });

  stream.addEventListener("alert", () => {
    document.body.animate(
      [
        { transform: "translateY(0px)" },
        { transform: "translateY(-4px)" },
        { transform: "translateY(0px)" }
      ],
      { duration: 260, easing: "ease-out" }
    );
  });

  stream.addEventListener("error", () => {
    state.streamConnected = false;
    setConnectionState("error", "Reconnecting to stream");
  });
}

elements.scanButton.addEventListener("click", () => {
  void postAction("/api/runtime/scan");
});

elements.toggleButton.addEventListener("click", () => {
  if (!state.snapshot?.monitor.running) {
    void postAction("/api/runtime/start");
    return;
  }

  void postAction("/api/runtime/stop");
});

async function boot() {
  setConnectionState("error", "Loading dashboard");
  const snapshot = await fetchSnapshot();
  renderSnapshot(snapshot);
  connectEventStream();
}

boot().catch((error) => {
  setConnectionState("error", "Dashboard failed to load");
  elements.alertsList.replaceChildren(
    Object.assign(document.createElement("div"), {
      className: "empty-state",
      textContent: error instanceof Error ? error.message : String(error)
    })
  );
});
