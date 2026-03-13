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

type WalletStatus = "funded" | "first-use" | "first-trade" | "active" | "depleted";

interface PositionRecord {
  title: string;
  outcome: string;
  side: string;
  marketSlug: string;
  usdSize: number;
  transactionHash: string;
  timestamp: number;
  timestampIso: string;
}

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
  totalDepositedUsdc: number;
  depositCount: number;
  firstDeposit: {
    amountUsdc: number;
    destination: string;
    timestampIso: string;
  } | null;
  latestDeposit: {
    amountUsdc: number;
    destination: string;
    timestampIso: string;
  } | null;
  positions: PositionRecord[];
  totalBetUsd: number;
  positionCount: number;
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
    }
  | {
      stage: "deposit";
      wallet: string;
      amountUsdc: number;
      totalDepositedUsdc: number;
      fundedUsd: number;
      destination: string;
      transactionHash: string;
      triggeredAt: string;
    }
  | {
      stage: "position";
      wallet: string;
      title: string;
      outcome: string;
      side: string;
      usdSize: number;
      totalBetUsd: number;
      fundedUsd: number;
      totalDepositedUsdc: number;
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
    depositCount: number;
    activeCount: number;
    depletedCount: number;
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

type WalletFilter = "all" | "funded" | "deposited" | "active" | "depleted";

interface UiState {
  snapshot: MonitorSnapshot | null;
  busy: boolean;
  walletFilter: WalletFilter;
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
  depositHits: HTMLElement;
  activeHits: HTMLElement;
  depletedHits: HTMLElement;
  lastAlert: HTMLElement;
  statusGrid: HTMLElement;
  depositWallets: HTMLElement;
  activeWallets: HTMLElement;
  walletFilters: HTMLElement;
  watchlistList: HTMLElement;
  alertsList: HTMLElement;
  walletCount: HTMLElement;
  alertCount: HTMLElement;
  scanButton: HTMLButtonElement;
  toggleButton: HTMLButtonElement;
  statusItemTemplate: HTMLTemplateElement;
  watchCardTemplate: HTMLTemplateElement;
  alertCardTemplate: HTMLTemplateElement;
}

const state: UiState = {
  snapshot: null,
  busy: false,
  walletFilter: "all"
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
  depositHits: requireElement("#deposit-hits", HTMLElement),
  activeHits: requireElement("#active-hits", HTMLElement),
  depletedHits: requireElement("#depleted-hits", HTMLElement),
  lastAlert: requireElement("#last-alert", HTMLElement),
  statusGrid: requireElement("#status-grid", HTMLElement),
  depositWallets: requireElement("#deposit-wallets", HTMLElement),
  activeWallets: requireElement("#active-wallets", HTMLElement),
  walletFilters: requireElement("#wallet-filters", HTMLElement),
  watchlistList: requireElement("#watchlist-list", HTMLElement),
  alertsList: requireElement("#alerts-list", HTMLElement),
  walletCount: requireElement("#wallet-count", HTMLElement),
  alertCount: requireElement("#alert-count", HTMLElement),
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
    maximumFractionDigits: 0
  }).format(value ?? 0);
}

function formatUsdPrecise(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value ?? 0);
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatRelative(value: string | null | undefined): string {
  if (!value) {
    return "-";
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
    return "-";
  }

  if ("error" in lastResult) {
    return `Error: ${lastResult.error}`;
  }

  return `${lastResult.alertCount} alerts, ${lastResult.processedBlocks} blocks`;
}

function badgeClass(status: string): string {
  switch (status) {
    case "funded":
    case "funding":
      return "badge-funded";
    case "first-use":
      return "badge-first-use";
    case "first-trade":
      return "badge-first-trade";
    case "deposit":
      return "badge-deposit";
    case "active":
    case "position":
      return "badge-active";
    case "depleted":
      return "badge-depleted";
    default:
      return "badge-funded";
  }
}

function createDetailCell(label: string, value: string, tooltip?: string): HTMLDivElement {
  const wrapper = document.createElement("div");
  if (tooltip) {
    wrapper.title = tooltip;
  }
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  wrapper.append(dt, dd);
  return wrapper;
}

function createLink(href: string, label: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  return link;
}

function renderStatusGrid(snapshot: MonitorSnapshot): void {
  const sync = snapshot.monitor.lastChainSync;
  const entries: Array<readonly [string, string]> = [
    ["Bootstrapped", snapshot.monitor.bootstrapped ? "Yes" : "No"],
    ["Boot Mode", snapshot.monitor.bootstrapMode],
    ["Last Poll", formatDate(snapshot.monitor.lastPollAt)],
    ["Last Success", formatDate(snapshot.monitor.lastSuccessfulPollAt)],
    ["Last Error", snapshot.monitor.lastError ?? "None"],
    ["Latest Block", sync?.latestBlock.toLocaleString() ?? "-"],
    ["Processed Block", sync?.lastProcessedBlock.toLocaleString() ?? "-"],
    ["Block Lag", sync ? `${sync.lagBlocks.toLocaleString()}` : "-"],
    ["Processed", sync?.processedBlocks?.toLocaleString() ?? "-"],
    ["Last Result", formatLastResult(snapshot.monitor.lastResult)]
  ];

  elements.statusGrid.replaceChildren(
    ...entries.map(([label, value]) => {
      const node = elements.statusItemTemplate.content.firstElementChild?.cloneNode(true);

      if (!(node instanceof HTMLElement)) {
        throw new Error("Status item template is invalid.");
      }

      const statusLabel = node.querySelector(".sbl");
      const statusValue = node.querySelector(".sbv");

      if (!(statusLabel instanceof HTMLElement) || !(statusValue instanceof HTMLElement)) {
        throw new Error("Status item template is missing required children.");
      }

      statusLabel.textContent = label;
      statusValue.textContent = value;
      return node;
    })
  );
}

function createPipeWalletRow(wallet: TrackedWalletRecord): HTMLElement {
  const row = document.createElement("div");
  row.className = "pw-row";

  const addr = document.createElement("span");
  addr.className = "pw-addr";
  addr.textContent = shortWallet(wallet.wallet);
  addr.title = wallet.wallet;

  const amount = document.createElement("span");
  amount.className = "pw-amount";
  amount.textContent = formatUsd(wallet.totalFundedUsd);

  row.append(addr);

  // Show key detail depending on status
  if ((wallet.status === "active" || wallet.status === "first-trade") && wallet.positionCount > 0) {
    const lastPos = wallet.positions[wallet.positions.length - 1];
    if (lastPos) {
      const detail = document.createElement("span");
      detail.className = "pw-detail";
      detail.textContent = `${lastPos.side} ${lastPos.outcome} · ${formatUsdPrecise(lastPos.usdSize)}`;
      detail.title = lastPos.title;
      row.append(detail);
    }
  } else if (wallet.depositCount > 0) {
    const detail = document.createElement("span");
    detail.className = "pw-detail";
    detail.textContent = `Deposited ${formatUsd(wallet.totalDepositedUsdc)}`;
    row.append(detail);
  } else if (wallet.firstUse) {
    const detail = document.createElement("span");
    detail.className = "pw-detail";
    detail.textContent = wallet.firstUse.kind;
    row.append(detail);
  }

  const link = createLink(`https://polymarket.com/profile/${wallet.wallet}`, "\u2192");
  link.className = "pw-link";
  row.append(amount, link);

  return row;
}

function renderPipelineWallets(snapshot: MonitorSnapshot): void {
  const depositedWallets = snapshot.watchlist.filter(
    (w: TrackedWalletRecord) =>
      w.depositCount > 0 && w.status !== "active" && w.status !== "depleted"
  );
  const activeWallets = snapshot.watchlist.filter(
    (w: TrackedWalletRecord) => w.status === "active"
  );

  depositedWallets.sort(
    (a: TrackedWalletRecord, b: TrackedWalletRecord) => b.totalDepositedUsdc - a.totalDepositedUsdc
  );
  activeWallets.sort(
    (a: TrackedWalletRecord, b: TrackedWalletRecord) => b.totalBetUsd - a.totalBetUsd
  );

  elements.depositWallets.replaceChildren(
    ...depositedWallets.map((w: TrackedWalletRecord) => createPipeWalletRow(w))
  );
  elements.activeWallets.replaceChildren(
    ...activeWallets.map((w: TrackedWalletRecord) => createPipeWalletRow(w))
  );
}

function matchesFilter(wallet: TrackedWalletRecord, filter: WalletFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "funded") {
    return wallet.status === "funded" || wallet.status === "first-use";
  }
  if (filter === "deposited") {
    return (
      wallet.depositCount > 0 &&
      wallet.status !== "active" &&
      wallet.status !== "depleted" &&
      wallet.status !== "first-trade"
    );
  }
  if (filter === "active") {
    return wallet.status === "active" || wallet.status === "first-trade";
  }
  if (filter === "depleted") {
    return wallet.status === "depleted";
  }
  return true;
}

function countByFilter(watchlist: TrackedWalletRecord[], filter: WalletFilter): number {
  return watchlist.filter((w) => matchesFilter(w, filter)).length;
}

function updateFilterButtons(snapshot: MonitorSnapshot): void {
  const buttons = elements.walletFilters.querySelectorAll(".filter-btn");
  for (const btn of buttons) {
    if (!(btn instanceof HTMLButtonElement)) continue;
    const filter = btn.dataset["filter"] as WalletFilter;
    const count =
      filter === "all" ? snapshot.watchlist.length : countByFilter(snapshot.watchlist, filter);

    // Update active state
    btn.classList.toggle("active", filter === state.walletFilter);

    // Update count badge
    let countEl = btn.querySelector(".filter-count");
    if (count > 0) {
      if (!countEl) {
        countEl = document.createElement("span");
        countEl.className = "filter-count";
        btn.append(countEl);
      }
      countEl.textContent = String(count);
    } else if (countEl) {
      countEl.remove();
    }
  }
}

function renderWatchlist(snapshot: MonitorSnapshot): void {
  elements.walletCount.textContent = String(snapshot.watchlist.length);
  updateFilterButtons(snapshot);

  const filtered = snapshot.watchlist.filter((w) => matchesFilter(w, state.walletFilter));

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent =
      state.walletFilter === "all"
        ? "No wallets tracked yet. Waiting for large fresh funding events."
        : `No ${state.walletFilter} wallets.`;
    elements.watchlistList.replaceChildren(empty);
    return;
  }

  elements.watchlistList.replaceChildren(
    ...filtered.map((wallet: TrackedWalletRecord) => {
      const card = elements.watchCardTemplate.content.firstElementChild?.cloneNode(true);

      if (!(card instanceof HTMLElement)) {
        throw new Error("Watch card template is invalid.");
      }

      const badge = card.querySelector(".wcard-badge");
      const addr = card.querySelector(".wcard-addr");
      const amount = card.querySelector(".wcard-amount");
      const grid = card.querySelector(".wcard-grid");
      const links = card.querySelector(".wcard-links");

      if (
        !(badge instanceof HTMLElement) ||
        !(addr instanceof HTMLElement) ||
        !(amount instanceof HTMLElement) ||
        !(grid instanceof HTMLElement) ||
        !(links instanceof HTMLElement)
      ) {
        throw new Error("Watch card template is missing required children.");
      }

      badge.textContent = wallet.status.replace("-", " ");
      badge.className = `wcard-badge ${badgeClass(wallet.status)}`;
      addr.textContent = shortWallet(wallet.wallet);
      addr.title = wallet.wallet;
      amount.textContent = formatUsd(wallet.totalFundedUsd);

      const rows: Array<readonly [string, string, string]> = [
        ["Type", wallet.walletKind, "EOA(개인) 또는 Contract(스마트 컨트랙트)"],
        ["Funded", formatDate(wallet.firstFunding.timestampIso), "최초 대규모 자금 유입 시각"],
        [
          "Asset",
          `${wallet.firstFunding.amountToken} ${wallet.firstFunding.assetSymbol}`,
          "유입된 토큰 종류와 수량"
        ],
        ["# Fundings", String(wallet.fundingCount), "총 펀딩 횟수"],
        [
          "Deposited",
          wallet.depositCount > 0 ? formatUsd(wallet.totalDepositedUsdc) : "Waiting...",
          "폴리마켓 컨트랙트에 입금한 총액"
        ],
        ["# Deposits", String(wallet.depositCount), "폴리마켓 입금 횟수"],
        ["Positions", String(wallet.positionCount), "보유 베팅 포지션 수"],
        [
          "Total Bet",
          wallet.totalBetUsd > 0 ? formatUsd(wallet.totalBetUsd) : "-",
          "누적 베팅 총액"
        ],
        [
          "First Use",
          wallet.firstUse?.kind ?? "Waiting...",
          "폴리마켓 첫 상호작용 (승인, 입금 등)"
        ],
        [
          "First Bet",
          wallet.firstTrade ? formatUsdPrecise(wallet.firstTrade.usdSize) : "Waiting...",
          "첫 베팅 금액"
        ],
        ["Market", wallet.firstTrade?.title ?? "-", "첫 베팅 마켓"],
        [
          "Time to Bet",
          wallet.firstTrade ? `${wallet.firstTrade.secondsFromFunding}s` : "-",
          "펀딩부터 첫 베팅까지 걸린 시간"
        ],
        ["Checked", formatDate(wallet.lastCheckedAt), "마지막 상태 확인 시각"]
      ];

      grid.replaceChildren(
        ...rows.map(([label, value, tooltip]) => createDetailCell(label, value, tooltip))
      );

      links.append(createLink(`https://polymarket.com/profile/${wallet.wallet}`, "Profile"));

      if (wallet.firstFunding.transactionHash) {
        links.append(
          createLink(
            `https://polygonscan.com/tx/${wallet.firstFunding.transactionHash}`,
            "Funding Tx"
          )
        );
      }

      if (wallet.firstTrade?.transactionHash) {
        links.append(
          createLink(`https://polygonscan.com/tx/${wallet.firstTrade.transactionHash}`, "Trade Tx")
        );
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
    case "deposit":
      return alert.amountUsdc;
    case "position":
      return alert.usdSize;
  }
}

function getAlertTitle(alert: PublishedMonitorAlert): string {
  switch (alert.stage) {
    case "funding":
      return shortWallet(alert.wallet);
    case "first-use":
      return alert.useKind;
    case "first-trade":
      return alert.title;
    case "deposit":
      return shortWallet(alert.wallet);
    case "position":
      return alert.title;
  }
}

function renderAlerts(snapshot: MonitorSnapshot): void {
  elements.alertCount.textContent = String(snapshot.alerts.length);

  if (snapshot.alerts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No lifecycle alerts yet.";
    elements.alertsList.replaceChildren(empty);
    return;
  }

  elements.alertsList.replaceChildren(
    ...snapshot.alerts.map((alert: PublishedMonitorAlert) => {
      const card = elements.alertCardTemplate.content.firstElementChild?.cloneNode(true);

      if (!(card instanceof HTMLElement)) {
        throw new Error("Alert card template is invalid.");
      }

      const badgeEl = card.querySelector(".acard-badge");
      const title = card.querySelector(".acard-title");
      const amount = card.querySelector(".acard-amount");
      const grid = card.querySelector(".acard-grid");
      const links = card.querySelector(".acard-links");

      if (
        !(badgeEl instanceof HTMLElement) ||
        !(title instanceof HTMLElement) ||
        !(amount instanceof HTMLElement) ||
        !(grid instanceof HTMLElement) ||
        !(links instanceof HTMLElement)
      ) {
        throw new Error("Alert card template is missing required children.");
      }

      badgeEl.textContent = alert.stage.replace("-", " ");
      badgeEl.className = `acard-badge ${badgeClass(alert.stage)}`;
      title.textContent = getAlertTitle(alert);
      amount.textContent = formatUsdPrecise(getAlertAmount(alert));

      const rows: Array<readonly [string, string]> = [
        ["Wallet", shortWallet(alert.wallet)],
        ["Detected", formatRelative(alert.triggeredAt)],
        ["Total Funded", formatUsd(alert.fundedUsd)]
      ];

      if (alert.stage === "funding") {
        rows.push(["Asset", `${alert.amountToken} ${alert.assetSymbol}`.trim()]);
      }

      if (alert.stage === "first-trade") {
        rows.push(["Trade Vol", formatUsdPrecise(alert.observedTradeUsd)]);
        rows.push(["Market", alert.title]);
        rows.push(["Position", `${alert.side || "-"} ${alert.outcome}`.trim()]);
      }

      if (alert.stage === "deposit") {
        rows.push(["Total Deposited", formatUsd(alert.totalDepositedUsdc)]);
      }

      if (alert.stage === "position") {
        rows.push(["Market", alert.title]);
        rows.push(["Position", `${alert.side || "-"} ${alert.outcome}`.trim()]);
        rows.push(["Total Bet", formatUsd(alert.totalBetUsd)]);
      }

      if (alert.transactionHash) {
        rows.push(["Tx", `${alert.transactionHash.slice(0, 10)}...`]);
      }

      grid.replaceChildren(...rows.map(([label, value]) => createDetailCell(label, value)));

      links.append(createLink(`https://polymarket.com/profile/${alert.wallet}`, "Profile"));

      if (alert.transactionHash) {
        links.append(createLink(`https://polygonscan.com/tx/${alert.transactionHash}`, "Tx"));
      }

      return card;
    })
  );
}

function renderSnapshot(snapshot: MonitorSnapshot): void {
  state.snapshot = snapshot;

  const monitorState = snapshot.monitor.running
    ? snapshot.monitor.polling
      ? "Polling"
      : "Armed"
    : "Paused";
  const chainLag = snapshot.monitor.lastChainSync?.lagBlocks;

  elements.thresholdValue.textContent = formatUsd(snapshot.monitor.fundingThresholdUsd);
  elements.intervalValue.textContent = `${Math.round(snapshot.monitor.pollIntervalMs / 1_000)}s`;
  elements.chainValue.textContent = chainLag === undefined ? "-" : `${chainLag} blk`;
  elements.webhookValue.textContent = snapshot.monitor.webhookConfigured ? "On" : "Off";
  elements.monitorState.textContent = monitorState;
  elements.monitorMeta.textContent = snapshot.monitor.lastSuccessfulPollAt
    ? formatRelative(snapshot.monitor.lastSuccessfulPollAt)
    : "Waiting";
  elements.trackedWallets.textContent = snapshot.stats.trackedWalletCount.toLocaleString();
  elements.depositHits.textContent = snapshot.stats.depositCount.toLocaleString();
  elements.activeHits.textContent = snapshot.stats.activeCount.toLocaleString();
  elements.depletedHits.textContent = snapshot.stats.depletedCount.toLocaleString();
  elements.lastAlert.textContent = snapshot.stats.lastAlertAt
    ? `Last: ${formatRelative(snapshot.stats.lastAlertAt)}`
    : "Funds exhausted";
  elements.toggleButton.textContent = snapshot.monitor.running ? "Pause" : "Resume";
  elements.toggleButton.disabled = state.busy;
  elements.scanButton.disabled = state.busy || snapshot.monitor.polling;

  renderStatusGrid(snapshot);
  renderPipelineWallets(snapshot);
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
      const errorMessage =
        isRecord(payload) && typeof payload["error"] === "string"
          ? payload["error"]
          : "Request failed";
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
    setConnectionState("connected", "Live");
  });

  stream.addEventListener("snapshot", (event: Event) => {
    if (!(event instanceof MessageEvent)) {
      return;
    }

    renderSnapshot(parseSnapshotPayload(JSON.parse(event.data) as unknown));
  });

  stream.addEventListener("alert", () => {
    document.querySelector(".pipeline")?.classList.add("flash");
    setTimeout(() => {
      document.querySelector(".pipeline")?.classList.remove("flash");
    }, 600);
  });

  stream.addEventListener("error", () => {
    setConnectionState("error", "Reconnecting");
  });
}

elements.walletFilters.addEventListener("click", (event: Event) => {
  const target = event.target;
  const button = target instanceof Element ? target.closest(".filter-btn") : null;

  if (!(button instanceof HTMLButtonElement) || !button.dataset["filter"]) {
    return;
  }

  state.walletFilter = button.dataset["filter"] as WalletFilter;
  if (state.snapshot) {
    renderWatchlist(state.snapshot);
  }
});

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
  setConnectionState("error", "Loading");
  const snapshot = await fetchSnapshot();
  renderSnapshot(snapshot);
  connectEventStream();
}

boot().catch((error: unknown) => {
  setConnectionState("error", "Failed");
  elements.alertsList.replaceChildren(
    Object.assign(document.createElement("div"), {
      className: "empty-state",
      textContent: error instanceof Error ? error.message : String(error)
    })
  );
});
