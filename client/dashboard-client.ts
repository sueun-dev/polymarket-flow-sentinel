function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type MonitorLastResult =
  | {
      reason: string;
      completedAt: string;
      alertCount: number;
      processedBlocks: number;
      latestBlock: number;
      lastProcessedBlock: number;
      newTrackedWallets: number;
      checkedWallets: number;
      bootstrapped: boolean;
    }
  | {
      reason: string;
      completedAt: string;
      error: string;
    }
  | null;

type WalletStatus = "funded" | "first-use" | "first-trade";

interface TrackedWalletRecord {
  wallet: string;
  walletKind: string;
  status: WalletStatus;
  totalFundedUsd: number;
  fundingCount: number;
  firstFunding: {
    amountToken: number;
    assetSymbol: string;
    transactionHash: string;
    timestampIso: string;
    timestamp: number;
  };
  firstUse: {
    kind: string;
  } | null;
  firstTrade: {
    title: string;
    outcome: string;
    side: string;
    usdSize: number;
    secondsFromFunding: number;
    transactionHash: string;
  } | null;
  lastCheckedAt: string | null;
}

type PublishedMonitorAlert =
  | {
      stage: "funding";
      wallet: string;
      amountUsd: number;
      fundedUsd: number;
      amountToken: number;
      assetSymbol: string;
      transactionHash: string;
      triggeredAt: string;
    }
  | {
      stage: "first-use";
      wallet: string;
      fundedUsd: number;
      useKind: string;
      transactionHash: string | undefined;
      triggeredAt: string;
    }
  | {
      stage: "first-trade";
      wallet: string;
      tradeUsd: number;
      fundedUsd: number;
      observedTradeUsd: number;
      title: string;
      outcome: string;
      side: string;
      transactionHash: string;
      triggeredAt: string;
    };

interface MonitorSnapshot {
  monitor: {
    running: boolean;
    polling: boolean;
    bootstrapped: boolean;
    fundingThresholdUsd: number;
    pollIntervalMs: number;
    webhookConfigured: boolean;
    lastSuccessfulPollAt: string | null;
    lastChainSync: {
      latestBlock: number;
      lastProcessedBlock: number;
      lagBlocks: number;
      processedBlocks?: number;
    } | null;
    bootstrapMode: string;
    lastPollAt: string | null;
    lastError: string | null;
    lastResult: MonitorLastResult;
  };
  stats: {
    trackedWalletCount: number;
    firstUseCount: number;
    firstTradeCount: number;
    lastAlertAt: string | null;
  };
  watchlist: TrackedWalletRecord[];
  alerts: PublishedMonitorAlert[];
}

function requireElement<T extends Element>(selector: string, expectedType: { new (): T }): T {
  const element = document.querySelector(selector);

  if (!(element instanceof expectedType)) {
    throw new Error(`Expected ${selector} to resolve to ${expectedType.name}.`);
  }

  return element;
}

interface UiState {
  snapshot: MonitorSnapshot | null;
  busy: boolean;
  streamConnected: boolean;
}

interface Elements {
  liveDot: HTMLSpanElement;
  liveLabel: HTMLSpanElement;
  thresholdValue: HTMLElement;
  intervalValue: HTMLElement;
  chainValue: HTMLElement;
  webhookValue: HTMLElement;
  monitorState: HTMLElement;
  monitorMeta: HTMLElement;
  trackedWallets: HTMLElement;
  firstUseHits: HTMLElement;
  firstTradeHits: HTMLElement;
  lastAlert: HTMLElement;
  statusGrid: HTMLElement;
  watchlistList: HTMLElement;
  alertsList: HTMLElement;
  scanButton: HTMLButtonElement;
  toggleButton: HTMLButtonElement;
  statusItemTemplate: HTMLTemplateElement;
  watchCardTemplate: HTMLTemplateElement;
  alertCardTemplate: HTMLTemplateElement;
}

const state: UiState = {
  snapshot: null,
  busy: false,
  streamConnected: false
};

const elements: Elements = {
  liveDot: requireElement("#live-dot", HTMLSpanElement),
  liveLabel: requireElement("#live-label", HTMLSpanElement),
  thresholdValue: requireElement("#threshold-value", HTMLElement),
  intervalValue: requireElement("#interval-value", HTMLElement),
  chainValue: requireElement("#chain-value", HTMLElement),
  webhookValue: requireElement("#webhook-value", HTMLElement),
  monitorState: requireElement("#monitor-state", HTMLElement),
  monitorMeta: requireElement("#monitor-meta", HTMLElement),
  trackedWallets: requireElement("#tracked-wallets", HTMLElement),
  firstUseHits: requireElement("#first-use-hits", HTMLElement),
  firstTradeHits: requireElement("#first-trade-hits", HTMLElement),
  lastAlert: requireElement("#last-alert", HTMLElement),
  statusGrid: requireElement("#status-grid", HTMLElement),
  watchlistList: requireElement("#watchlist-list", HTMLElement),
  alertsList: requireElement("#alerts-list", HTMLElement),
  scanButton: requireElement("#scan-button", HTMLButtonElement),
  toggleButton: requireElement("#toggle-button", HTMLButtonElement),
  statusItemTemplate: requireElement("#status-item-template", HTMLTemplateElement),
  watchCardTemplate: requireElement("#watch-card-template", HTMLTemplateElement),
  alertCardTemplate: requireElement("#alert-card-template", HTMLTemplateElement)
};

function formatUsd(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value ?? 0);
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}

function formatRelative(value: string | null | undefined): string {
  if (!value) {
    return "No timestamp";
  }

  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1_000);
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

function shortWallet(wallet: string | null | undefined): string {
  if (!wallet) {
    return "-";
  }

  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function setConnectionState(mode: "connected" | "error" | "idle", label: string): void {
  elements.liveDot.classList.remove("connected", "error");

  if (mode === "connected") {
    elements.liveDot.classList.add("connected");
  } else if (mode === "error") {
    elements.liveDot.classList.add("error");
  }

  elements.liveLabel.textContent = label;
}

function formatLastResult(lastResult: MonitorLastResult): string {
  if (!lastResult) {
    return "None yet";
  }

  if ("error" in lastResult) {
    return `Error: ${lastResult.error}`;
  }

  return `${lastResult.alertCount} new alerts`;
}

function createDefinitionRow(label: string, value: string): HTMLDivElement {
  const wrapper = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  wrapper.append(dt, dd);
  return wrapper;
}

function renderStatusGrid(snapshot: MonitorSnapshot): void {
  const sync = snapshot.monitor.lastChainSync;
  const entries: Array<readonly [string, string]> = [
    ["Bootstrapped", snapshot.monitor.bootstrapped ? "Yes" : "No"],
    ["Boot Mode", snapshot.monitor.bootstrapMode],
    ["Last Poll", formatDate(snapshot.monitor.lastPollAt)],
    ["Last Success", formatDate(snapshot.monitor.lastSuccessfulPollAt)],
    ["Last Error", snapshot.monitor.lastError ?? "None"],
    ["Latest Polygon Block", sync?.latestBlock.toLocaleString() ?? "-"],
    ["Last Processed Block", sync?.lastProcessedBlock.toLocaleString() ?? "-"],
    ["Block Lag", sync ? `${sync.lagBlocks.toLocaleString()} blocks` : "-"],
    ["Processed Blocks", sync?.processedBlocks?.toLocaleString() ?? "-"],
    ["Last Result", formatLastResult(snapshot.monitor.lastResult)]
  ];

  elements.statusGrid.replaceChildren(
    ...entries.map(([label, value]) => {
      const node = elements.statusItemTemplate.content.firstElementChild?.cloneNode(true);

      if (!(node instanceof HTMLElement)) {
        throw new Error("Status item template is invalid.");
      }

      const statusLabel = node.querySelector(".status-label");
      const statusValue = node.querySelector(".status-value");

      if (!(statusLabel instanceof HTMLElement) || !(statusValue instanceof HTMLElement)) {
        throw new Error("Status item template is missing required children.");
      }

      statusLabel.textContent = label;
      statusValue.textContent = value;
      return node;
    })
  );
}

function createLink(href: string, label: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  return link;
}

function renderWatchlist(snapshot: MonitorSnapshot): void {
  if (snapshot.watchlist.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No fresh large-funding wallets are being tracked yet.";
    elements.watchlistList.replaceChildren(empty);
    return;
  }

  elements.watchlistList.replaceChildren(
    ...snapshot.watchlist.map((wallet: TrackedWalletRecord) => {
      const card = elements.watchCardTemplate.content.firstElementChild?.cloneNode(true);

      if (!(card instanceof HTMLElement)) {
        throw new Error("Watch card template is invalid.");
      }

      const watchStatus = card.querySelector(".watch-status");
      const watchWallet = card.querySelector(".watch-wallet");
      const watchFunded = card.querySelector(".watch-funded");
      const details = card.querySelector(".watch-details");
      const links = card.querySelector(".watch-links");

      if (
        !(watchStatus instanceof HTMLElement) ||
        !(watchWallet instanceof HTMLElement) ||
        !(watchFunded instanceof HTMLElement) ||
        !(details instanceof HTMLElement) ||
        !(links instanceof HTMLElement)
      ) {
        throw new Error("Watch card template is missing required children.");
      }

      watchStatus.textContent = wallet.status.replace("-", " ").toUpperCase();
      watchWallet.textContent = shortWallet(wallet.wallet);
      watchFunded.textContent = formatUsd(wallet.totalFundedUsd);

      const detailRows: Array<readonly [string, string]> = [
        ["Type", wallet.walletKind],
        ["First Funding", formatDate(wallet.firstFunding.timestampIso)],
        ["Funding Asset", `${wallet.firstFunding.amountToken} ${wallet.firstFunding.assetSymbol}`],
        ["Funding Count", String(wallet.fundingCount)],
        ["First Use", wallet.firstUse?.kind ?? "Waiting"],
        ["First Bet", wallet.firstTrade ? formatUsd(wallet.firstTrade.usdSize) : "Waiting"],
        ["Bet Market", wallet.firstTrade?.title ?? "Waiting"],
        [
          "Position",
          wallet.firstTrade ? `${wallet.firstTrade.side || "-"} ${wallet.firstTrade.outcome}`.trim() : "Waiting"
        ],
        ["Lag to Bet", wallet.firstTrade ? `${wallet.firstTrade.secondsFromFunding}s` : "-"],
        ["Last Checked", formatDate(wallet.lastCheckedAt)]
      ];

      details.replaceChildren(...detailRows.map(([label, value]) => createDefinitionRow(label, value)));
      links.append(createLink(`https://polymarket.com/profile/${wallet.wallet}`, "Wallet profile"));

      if (wallet.firstFunding.transactionHash) {
        links.append(createLink(`https://polygonscan.com/tx/${wallet.firstFunding.transactionHash}`, "Funding tx"));
      }

      if (wallet.firstTrade?.transactionHash) {
        links.append(createLink(`https://polygonscan.com/tx/${wallet.firstTrade.transactionHash}`, "First trade tx"));
      }

      return card;
    })
  );
}

function getAlertAmount(alert: PublishedMonitorAlert): number {
  switch (alert.stage) {
    case "funding":
      return alert.amountUsd;
    case "first-trade":
      return alert.tradeUsd;
    case "first-use":
      return alert.fundedUsd;
  }
}

function renderAlerts(snapshot: MonitorSnapshot): void {
  if (snapshot.alerts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No funding-to-bet lifecycle alerts have triggered yet.";
    elements.alertsList.replaceChildren(empty);
    return;
  }

  elements.alertsList.replaceChildren(
    ...snapshot.alerts.map((alert: PublishedMonitorAlert) => {
      const card = elements.alertCardTemplate.content.firstElementChild?.cloneNode(true);

      if (!(card instanceof HTMLElement)) {
        throw new Error("Alert card template is invalid.");
      }

      const eyebrow = card.querySelector(".alert-eyebrow");
      const title = card.querySelector(".alert-title");
      const amount = card.querySelector(".alert-amount");
      const details = card.querySelector(".alert-details");
      const links = card.querySelector(".alert-links");

      if (
        !(eyebrow instanceof HTMLElement) ||
        !(title instanceof HTMLElement) ||
        !(amount instanceof HTMLElement) ||
        !(details instanceof HTMLElement) ||
        !(links instanceof HTMLElement)
      ) {
        throw new Error("Alert card template is missing required children.");
      }

      eyebrow.textContent = alert.stage.replace("-", " ").toUpperCase();
      title.textContent =
        alert.stage === "first-trade" ? alert.title : alert.stage === "first-use" ? alert.useKind : shortWallet(alert.wallet);
      amount.textContent = formatUsd(getAlertAmount(alert));

      const detailRows: Array<readonly [string, string]> = [
        ["Wallet", shortWallet(alert.wallet)],
        ["Detected", formatRelative(alert.triggeredAt)],
        ["Funding Total", formatUsd(alert.fundedUsd)],
        ["Funding Asset", alert.stage === "funding" ? `${alert.amountToken} ${alert.assetSymbol}`.trim() : "-"],
        ["Tx", alert.transactionHash ? `${alert.transactionHash.slice(0, 10)}...` : "-"]
      ];

      if (alert.stage === "first-trade") {
        detailRows.push(["Observed Trade Volume", formatUsd(alert.observedTradeUsd)]);
        detailRows.push(["Bet Market", alert.title]);
        detailRows.push(["Position", `${alert.side || "-"} ${alert.outcome}`.trim()]);
      }

      details.replaceChildren(...detailRows.map(([label, value]) => createDefinitionRow(label, value)));
      links.append(createLink(`https://polymarket.com/profile/${alert.wallet}`, "Wallet profile"));

      if (alert.transactionHash) {
        links.append(createLink(`https://polygonscan.com/tx/${alert.transactionHash}`, "Polygon tx"));
      }

      return card;
    })
  );
}

function renderSnapshot(snapshot: MonitorSnapshot): void {
  state.snapshot = snapshot;

  const monitorState = snapshot.monitor.running ? (snapshot.monitor.polling ? "Polling" : "Armed") : "Paused";
  const chainLag = snapshot.monitor.lastChainSync?.lagBlocks;

  elements.thresholdValue.textContent = formatUsd(snapshot.monitor.fundingThresholdUsd);
  elements.intervalValue.textContent = `${Math.round(snapshot.monitor.pollIntervalMs / 1_000)}s`;
  elements.chainValue.textContent = chainLag === undefined ? "-" : `${chainLag} blocks`;
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

function parseSnapshotPayload(value: unknown): MonitorSnapshot {
  if (!isRecord(value) || !isRecord(value["monitor"]) || !isRecord(value["stats"])) {
    throw new Error("Dashboard payload is malformed.");
  }

  return value as unknown as MonitorSnapshot;
}

async function fetchSnapshot(): Promise<MonitorSnapshot> {
  const response = await fetch("/api/dashboard");
  if (!response.ok) {
    throw new Error(`Dashboard fetch failed with HTTP ${response.status}`);
  }

  return parseSnapshotPayload((await response.json()) as unknown);
}

async function postAction(actionPath: string): Promise<void> {
  state.busy = true;
  if (state.snapshot) {
    renderSnapshot(state.snapshot);
  }

  try {
    const response = await fetch(actionPath, {
      method: "POST"
    });
    const payload = (await response.json()) as unknown;

    if (!response.ok) {
      const errorMessage = isRecord(payload) && typeof payload["error"] === "string" ? payload["error"] : "Request failed";
      throw new Error(errorMessage);
    }

    renderSnapshot(parseSnapshotPayload(payload));
  } finally {
    state.busy = false;
    if (state.snapshot) {
      renderSnapshot(state.snapshot);
    }
  }
}

function connectEventStream(): void {
  const stream = new EventSource("/api/events");

  stream.addEventListener("open", () => {
    state.streamConnected = true;
    setConnectionState("connected", "Live stream connected");
  });

  stream.addEventListener("snapshot", (event: Event) => {
    if (!(event instanceof MessageEvent)) {
      return;
    }

    renderSnapshot(parseSnapshotPayload(JSON.parse(event.data) as unknown));
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

async function boot(): Promise<void> {
  setConnectionState("error", "Loading dashboard");
  const snapshot = await fetchSnapshot();
  renderSnapshot(snapshot);
  connectEventStream();
}

boot().catch((error: unknown) => {
  setConnectionState("error", "Dashboard failed to load");
  elements.alertsList.replaceChildren(
    Object.assign(document.createElement("div"), {
      className: "empty-state",
      textContent: error instanceof Error ? error.message : String(error)
    })
  );
});
