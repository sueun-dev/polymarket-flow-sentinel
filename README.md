# Polymarket Flow Sentinel

> Real-time intelligence for newly funded Polygon wallets before their first Polymarket bet.

## English

`Polymarket Flow Sentinel` is a real-time monitoring dashboard that detects wallets depositing fresh
USDC into Polymarket contracts on Polygon, then follows each wallet through its first on-chain
Polymarket touch, its first bet, and every position it takes afterward — until the wallet's funds are
depleted.

### Core Signal

- Watches **direct USDC deposits into Polymarket contracts** (ConditionalTokens, NegRiskAdapter, CTF
  Exchange, NegRisk CTF Exchange) — this is the primary entry point that registers a wallet.
- Registers a wallet once its **cumulative deposits reach `>= $10,000`** (`POLYMARKET_MIN_DEPOSIT_USD`),
  accumulating sub-threshold deposits across block batches.
- Enriches tracked wallets with broader Polygon funding inflows across `USDC.e`, `USDC`, `USDT`, `DAI`,
  `WETH`, `WBTC`, `SAND`, and `POL` (volatile assets are converted to USD via an external price API).
- Detects each wallet's `first use` (USDC approval to the ConditionalTokens contract, `ApprovalForAll`
  to the exchanges, or its first Polymarket activity).
- Detects the `first trade` and tracks every subsequent `position` — market title, outcome, side, bet
  size, and post-funding observed trade volume.
- Derives a wallet lifecycle status: `funded` → `first-use` → `active` → `depleted` (a wallet is
  considered depleted once its total bet size meets or exceeds its total deposits).
- Emits the same lifecycle events to the dashboard (live), the console, and an optional webhook.

### Prerequisites

- Node.js `>= 20`
- A Polygon JSON-RPC endpoint (a public default is provided)

### Quick Start

```bash
npm install
npm start
```

Open `http://localhost:3000` in your browser.

Run a single CLI scan and exit:

```bash
npm run track:once
```

Run the monitor continuously from the CLI (no dashboard server):

```bash
npm run track
```

### HTTP / SSE API

The dashboard server (`npm start`) exposes:

- `GET /api/health` — liveness probe.
- `GET /api/dashboard` — current monitor snapshot (status, stats, watchlist, recent alerts).
- `GET /api/events` — Server-Sent Events stream of `snapshot` and `alert` events.
- `POST /api/runtime/scan` — trigger one scan immediately.
- `POST /api/runtime/start` / `POST /api/runtime/stop` — start or pause the polling loop.

### TypeScript & Tooling

- The server, monitor logic, and tests are fully written in TypeScript.
- The browser source lives in `client/dashboard-client.ts`.
- `npm start` and `npm run build:client` generate `public/dashboard-client.js`.
- `npm run typecheck` runs strict type checks (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`).
- `npm test` runs the typecheck plus the `node:test` suite via `tsx`.
- `npm run lint` (TS + CSS + HTML), `npm run format` / `npm run format:check`, and `npm run verify`
  (format check + lint + client build + tests) are available for CI-style checks.

### Project Structure

```text
client/   browser TypeScript source
public/   static assets and generated browser JS
src/      server, monitor pipeline (src/monitor/), RPC/API clients, types, state, alerts
test/     monitor tests
```

### Environment Variables

All variables are optional; defaults are shown below.

```bash
POLYGON_RPC_URL=https://polygon.drpc.org
POLYMARKET_DATA_API_BASE_URL=https://data-api.polymarket.com
POLYMARKET_MIN_DEPOSIT_USD=10000
POLYMARKET_MIN_FUNDING_USD=50000
POLYMARKET_MIN_TRADE_USD=0
POLYMARKET_POLL_INTERVAL_MS=5000
POLYMARKET_STARTUP_LOOKBACK_BLOCKS=256
POLYMARKET_CONFIRMATION_BLOCKS=12
POLYMARKET_BLOCK_BATCH_SIZE=20
POLYMARKET_ACTIVITY_PAGE_SIZE=500
POLYMARKET_ACTIVITY_PAGE_COUNT=10
POLYMARKET_PRICE_CACHE_MS=60000
POLYMARKET_MAX_TRACKED_WALLETS=2000
POLYMARKET_MAX_SEEN_FUNDING_TRANSFERS=50000
POLYMARKET_MAX_SENT_EVENT_KEYS=20000
POLYMARKET_MAX_RECENT_ALERTS=100
POLYMARKET_REQUEST_TIMEOUT_MS=15000
POLYMARKET_REFRESH_CONCURRENCY=10
POLYMARKET_BOOTSTRAP_MODE=scan
POLYMARKET_STATE_FILE=.data/polymarket-flow-sentinel.json
POLYMARKET_WEBHOOK_URL=
HOST=0.0.0.0
PORT=3000
```

Notes:

- `POLYMARKET_MIN_DEPOSIT_USD` is the registration gate: a wallet enters the watchlist when its
  cumulative direct deposits to Polymarket contracts cross this threshold.
- `POLYMARKET_MIN_FUNDING_USD` is surfaced as the dashboard's "funding threshold" label; the funding
  stage only enriches already-tracked wallets and does not register new ones.
- `POLYMARKET_CONFIRMATION_BLOCKS` keeps the most recent N blocks unprocessed so shallow Polygon reorgs
  do not corrupt the cursor.
- `POLYMARKET_BOOTSTRAP_MODE=scan` backfills recent blocks immediately; `skip` starts from the latest
  block and only monitors forward.
- `POLYMARKET_MIN_TRADE_USD=0` records the first trade regardless of size.
- `POLYMARKET_ACTIVITY_PAGE_*` controls how deep wallet-specific trade history is fetched.
- `POLYMARKET_PRICE_CACHE_MS` controls USD price caching for volatile assets.
- `POLYMARKET_STATE_FILE` defaults to `.data/polymarket-flow-sentinel.json` (gitignored); relative
  paths are resolved against the current working directory.

### Alert Stages

- `deposit`: a fresh wallet deposited USDC directly into a Polymarket contract.
- `funding`: additional Polygon funding observed for an already-tracked wallet.
- `first-use`: Polymarket approval or first activity detected.
- `first-trade`: the wallet's first actual Polymarket bet detected.
- `position`: a subsequent position taken by a tracked wallet.

### Detection Notes

- Uses the Polymarket public activity API and Polygon RPC together.
- First-use signals combine approval events against official Polymarket contracts with
  wallet-specific activity.
- Pass-through transfers inside the same transaction are excluded from funding enrichment (current
  batch only; amounts are not netted).
- Volatile assets are converted to USD through an external pricing API.
- Deposit detection looks only at **direct** ERC-20 USDC `Transfer` logs whose `to` is a Polymarket
  contract, treating `from` as the depositor. Deposits routed through a proxy/relayer or gasless
  meta-transaction may be missed or attributed to the relay address (known limitation). The canonical
  profile's proxy wallet is recorded as an alias for trade matching.
- Running continuously with persisted state is much more reliable than watching only a recent global
  trade window.

---

## 한국어

`Polymarket Flow Sentinel`은 Polygon에서 새로 USDC를 Polymarket 컨트랙트에 입금하는 지갑을 먼저 잡고,
그 지갑이 Polymarket에 처음 손대는 순간, 첫 배팅, 그리고 이후 모든 포지션을 자금이 소진될 때까지 이어서
추적하는 실시간 모니터링 대시보드입니다.

### 핵심 시그널

- **Polymarket 컨트랙트(ConditionalTokens, NegRiskAdapter, CTF Exchange, NegRisk CTF Exchange)로의
  직접 USDC 입금**을 감시합니다. 지갑을 watchlist에 등록하는 1차 진입점입니다.
- 누적 입금액이 **`>= $10,000`** (`POLYMARKET_MIN_DEPOSIT_USD`)에 도달하면 지갑을 등록하며, 임계값
  미만의 입금은 블록 배치 사이에 누적합니다.
- 등록된 지갑에 대해 `USDC.e`, `USDC`, `USDT`, `DAI`, `WETH`, `WBTC`, `SAND`, `POL` 유입을 추가로
  반영합니다(변동성 자산은 외부 가격 API로 USD 환산).
- 지갑별 `첫 사용`(ConditionalTokens에 대한 USDC 승인, 거래소에 대한 `ApprovalForAll`, 또는 첫
  Polymarket activity)을 감지합니다.
- `첫 TRADE`를 감지하고 이후 모든 `position`(시장명, outcome, 방향, 금액, funding 이후 누적 거래 규모)을
  추적합니다.
- 지갑 상태를 `funded` → `first-use` → `active` → `depleted`로 도출합니다(총 배팅액이 총 입금액 이상이면
  자금 소진으로 판단).
- 대시보드(실시간), 콘솔, 선택적 웹훅으로 동일한 이벤트를 전달합니다.

### 사전 요구사항

- Node.js `>= 20`
- Polygon JSON-RPC 엔드포인트(공개 기본값 제공)

### 빠른 시작

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000`으로 접속하면 됩니다.

CLI로 한 번만 스캔하고 종료:

```bash
npm run track:once
```

CLI로 대시보드 서버 없이 계속 모니터링:

```bash
npm run track
```

### HTTP / SSE API

대시보드 서버(`npm start`)가 제공하는 엔드포인트:

- `GET /api/health` — 헬스 체크.
- `GET /api/dashboard` — 현재 모니터 스냅샷(상태, 통계, watchlist, 최근 알림).
- `GET /api/events` — `snapshot`/`alert` 이벤트의 Server-Sent Events 스트림.
- `POST /api/runtime/scan` — 즉시 1회 스캔.
- `POST /api/runtime/start` / `POST /api/runtime/stop` — 폴링 루프 시작/일시정지.

### TypeScript & 도구

- 서버, 모니터, 테스트 코드는 모두 TypeScript로 작성되어 있습니다.
- 브라우저 클라이언트 소스는 `client/dashboard-client.ts`에 있습니다.
- `npm start`나 `npm run build:client` 시 `public/dashboard-client.js`가 생성됩니다.
- `npm run typecheck`는 `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`를 켠 상태로
  검사합니다.
- `npm test`는 typecheck와 `node:test` 스위트를 `tsx`로 실행합니다.
- `npm run lint`(TS + CSS + HTML), `npm run format` / `npm run format:check`, `npm run verify`(format
  체크 + lint + 클라이언트 빌드 + 테스트)도 사용할 수 있습니다.

### 프로젝트 구조

```text
client/   브라우저 TypeScript 소스
public/   정적 파일과 생성된 브라우저 JS
src/      서버, 모니터 파이프라인(src/monitor/), RPC/API 클라이언트, 타입, 상태 저장, 알림
test/     모니터 테스트
```

### 환경 변수

모든 변수는 선택 사항이며, 아래는 기본값입니다.

```bash
POLYGON_RPC_URL=https://polygon.drpc.org
POLYMARKET_DATA_API_BASE_URL=https://data-api.polymarket.com
POLYMARKET_MIN_DEPOSIT_USD=10000
POLYMARKET_MIN_FUNDING_USD=50000
POLYMARKET_MIN_TRADE_USD=0
POLYMARKET_POLL_INTERVAL_MS=5000
POLYMARKET_STARTUP_LOOKBACK_BLOCKS=256
POLYMARKET_CONFIRMATION_BLOCKS=12
POLYMARKET_BLOCK_BATCH_SIZE=20
POLYMARKET_ACTIVITY_PAGE_SIZE=500
POLYMARKET_ACTIVITY_PAGE_COUNT=10
POLYMARKET_PRICE_CACHE_MS=60000
POLYMARKET_MAX_TRACKED_WALLETS=2000
POLYMARKET_MAX_SEEN_FUNDING_TRANSFERS=50000
POLYMARKET_MAX_SENT_EVENT_KEYS=20000
POLYMARKET_MAX_RECENT_ALERTS=100
POLYMARKET_REQUEST_TIMEOUT_MS=15000
POLYMARKET_REFRESH_CONCURRENCY=10
POLYMARKET_BOOTSTRAP_MODE=scan
POLYMARKET_STATE_FILE=.data/polymarket-flow-sentinel.json
POLYMARKET_WEBHOOK_URL=
HOST=0.0.0.0
PORT=3000
```

메모:

- `POLYMARKET_MIN_DEPOSIT_USD`가 등록 기준입니다. Polymarket 컨트랙트로의 누적 직접 입금이 이 값을 넘으면
  watchlist에 들어갑니다.
- `POLYMARKET_MIN_FUNDING_USD`는 대시보드의 "funding threshold" 라벨로 노출됩니다. funding 단계는
  이미 추적 중인 지갑을 보강만 하며 새 지갑을 등록하지 않습니다.
- `POLYMARKET_CONFIRMATION_BLOCKS`는 최근 N개 블록을 미처리 상태로 두어 얕은 Polygon reorg가 커서를
  오염시키지 않게 합니다.
- `POLYMARKET_BOOTSTRAP_MODE=scan`이면 최근 블록을 백필해서 바로 후보를 찾고, `skip`이면 현재 최신
  블록만 기준점으로 잡고 다음 폴부터 감시합니다.
- `POLYMARKET_MIN_TRADE_USD=0`이면 첫 거래는 금액과 무관하게 기록합니다.
- `POLYMARKET_ACTIVITY_PAGE_*`는 funding 이후 지갑별 Polymarket 거래 이력을 얼마나 깊게 긁을지 정합니다.
- `POLYMARKET_PRICE_CACHE_MS`는 변동성 자산의 USD 가격 캐시 시간을 정합니다.
- `POLYMARKET_STATE_FILE` 기본값은 `.data/polymarket-flow-sentinel.json`(gitignore 대상)이며, 상대
  경로는 현재 작업 디렉터리를 기준으로 해석합니다.

### 알림 단계

- `deposit`: fresh wallet이 Polymarket 컨트랙트로 USDC를 직접 입금
- `funding`: 이미 추적 중인 지갑에 대한 추가 Polygon funding 감지
- `first-use`: Polymarket 관련 승인 또는 첫 activity
- `first-trade`: 해당 지갑의 첫 실제 Polymarket 배팅
- `position`: 추적 중인 지갑의 이후 포지션

### 탐지 메모

- Polymarket 공개 activity API와 Polygon RPC를 함께 사용합니다.
- 첫 사용 신호는 Polymarket 공식 배포 주소에 대한 승인 이벤트와 wallet-specific activity를 같이 봅니다.
- 같은 트랜잭션 안에서 중간 계약으로 바로 흘러가는 pass-through transfer는 funding 보강에서 제외합니다.
  (단, 같은 배치 안에서만 탐지하며 금액은 비교하지 않습니다.)
- 변동성 자산은 외부 가격 API로 USD 환산합니다.
- 입금 탐지는 Polymarket 컨트랙트로 **직접** 전송된 ERC-20 USDC `Transfer`만 보고 `from`을 입금자로
  간주합니다. 따라서 proxy/relayer를 거치는 gasless 입금은 놓치거나 relay 주소를 입금자로 잘못 귀속할 수
  있습니다 (알려진 한계). 트레이드 매칭을 위해 공개 프로필의 proxy 지갑은 alias로 추가합니다.
- state를 유지한 채 계속 실행하면 단순 최근 거래창 감시보다 훨씬 안정적으로 deposit-to-bet 흐름을 잡을 수
  있습니다.
