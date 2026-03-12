# Polymarket Flow Sentinel

## English

`Polymarket Flow Sentinel` is a real-time monitoring dashboard that watches for large fresh funding on Polygon, then follows the wallet through its first Polymarket touch and first bet.

### Core Signal

- Reads Polygon funding inflows.
- Watches `USDC.e`, `USDC`, `USDT`, `DAI`, `WETH`, `WBTC`, `SAND`, and `POL`.
- Tracks only wallets funded with `>= $50,000`.
- Excludes wallets with prior Polymarket activity.
- Follows `first approval`, `first activity`, and `first trade`.
- Shows market title, position, bet size, and post-funding observed trade volume.
- Emits the same lifecycle events to the dashboard, console, and optional webhook.

### Quick Start

```bash
npm install
npm start
```

Open `http://localhost:3000` in your browser.

Run a single CLI scan:

```bash
npm run track:once
```

### TypeScript

- The server, monitor logic, and tests are fully migrated to TypeScript.
- The browser source lives in `client/dashboard-client.ts`.
- `npm start` and `npm run build:client` generate `public/dashboard-client.js`.
- `npm run typecheck` runs strict type checks with `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.

### Project Structure

```text
client/   browser TypeScript source
public/   static assets and generated browser JS
src/      server, monitor, RPC/API clients, types, state, alerts
test/     monitor tests
```

### Environment Variables

```bash
POLYGON_RPC_URL=https://polygon.drpc.org
POLYMARKET_DATA_API_BASE_URL=https://data-api.polymarket.com
POLYMARKET_MIN_FUNDING_USD=50000
POLYMARKET_MIN_TRADE_USD=0
POLYMARKET_POLL_INTERVAL_MS=5000
POLYMARKET_STARTUP_LOOKBACK_BLOCKS=256
POLYMARKET_BLOCK_BATCH_SIZE=20
POLYMARKET_ACTIVITY_PAGE_SIZE=500
POLYMARKET_ACTIVITY_PAGE_COUNT=10
POLYMARKET_PRICE_CACHE_MS=60000
POLYMARKET_MAX_TRACKED_WALLETS=2000
POLYMARKET_MAX_SEEN_FUNDING_TRANSFERS=50000
POLYMARKET_MAX_SENT_EVENT_KEYS=20000
POLYMARKET_MAX_RECENT_ALERTS=100
POLYMARKET_REQUEST_TIMEOUT_MS=15000
POLYMARKET_BOOTSTRAP_MODE=scan
POLYMARKET_STATE_FILE=/absolute/path/to/polymarket-flow-sentinel.json
POLYMARKET_WEBHOOK_URL=
HOST=0.0.0.0
PORT=3000
```

Notes:

- `POLYMARKET_BOOTSTRAP_MODE=scan` backfills recent blocks immediately.
- `POLYMARKET_BOOTSTRAP_MODE=skip` starts from the latest block and only monitors forward.
- `POLYMARKET_MIN_TRADE_USD=0` records the first trade regardless of size.
- `POLYMARKET_ACTIVITY_PAGE_*` controls how deep wallet-specific trade history is fetched.
- `POLYMARKET_PRICE_CACHE_MS` controls USD price caching for volatile assets.

### Alert Stages

- `funding`: large fresh-wallet funding detected
- `first-use`: Polymarket approval or first activity detected
- `first-trade`: the wallet's first actual Polymarket bet detected

### Detection Notes

- Uses the Polymarket public activity API and Polygon RPC together.
- First-use signals combine approval events against official Polymarket contracts and wallet-specific activity.
- Pass-through transfers inside the same transaction are excluded from funding candidates.
- Volatile assets are converted to USD through an external pricing API.
- Running continuously with persisted state is much more reliable than watching only a recent global trade window.

---

## 한국어

`Polymarket Flow Sentinel`은 Polygon에서 새로 큰 자금이 들어온 지갑을 먼저 잡고, 그 지갑이 Polymarket에 처음 손대는 순간과 첫 배팅까지 이어서 추적하는 실시간 모니터링 대시보드입니다.

### 핵심 시그널

- Polygon funding asset 유입을 읽습니다.
- 현재 감시 자산은 `USDC.e`, `USDC`, `USDT`, `DAI`, `WETH`, `WBTC`, `SAND`, `POL`입니다.
- `>= $50,000` 이상 유입된 지갑만 watchlist에 올립니다.
- 이미 Polymarket 활동 이력이 있는 지갑은 제외합니다.
- `첫 승인`, `첫 activity`, `첫 TRADE`를 이어서 확인합니다.
- 첫 배팅이 잡히면 시장명, 포지션, 금액, funding 이후 누적 거래 규모를 같이 보여줍니다.
- 대시보드, 콘솔, 웹훅으로 동일한 이벤트를 전달합니다.

### 빠른 시작

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000`으로 접속하면 됩니다.

CLI로 한 번만 스캔:

```bash
npm run track:once
```

### TypeScript

- 서버, 모니터, 테스트 코드는 모두 TypeScript로 전환되었습니다.
- 브라우저 클라이언트 소스는 `client/dashboard-client.ts`에 있습니다.
- `npm start`나 `npm run build:client` 시 `public/dashboard-client.js`가 생성됩니다.
- `npm run typecheck`는 `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` 등을 켠 상태로 검사합니다.

### 프로젝트 구조

```text
client/   브라우저 TypeScript 소스
public/   정적 파일과 생성된 브라우저 JS
src/      서버, 모니터, RPC/API 클라이언트, 타입, 상태 저장, 알림
test/     모니터 테스트
```

### 환경 변수

```bash
POLYGON_RPC_URL=https://polygon.drpc.org
POLYMARKET_DATA_API_BASE_URL=https://data-api.polymarket.com
POLYMARKET_MIN_FUNDING_USD=50000
POLYMARKET_MIN_TRADE_USD=0
POLYMARKET_POLL_INTERVAL_MS=5000
POLYMARKET_STARTUP_LOOKBACK_BLOCKS=256
POLYMARKET_BLOCK_BATCH_SIZE=20
POLYMARKET_ACTIVITY_PAGE_SIZE=500
POLYMARKET_ACTIVITY_PAGE_COUNT=10
POLYMARKET_PRICE_CACHE_MS=60000
POLYMARKET_MAX_TRACKED_WALLETS=2000
POLYMARKET_MAX_SEEN_FUNDING_TRANSFERS=50000
POLYMARKET_MAX_SENT_EVENT_KEYS=20000
POLYMARKET_MAX_RECENT_ALERTS=100
POLYMARKET_REQUEST_TIMEOUT_MS=15000
POLYMARKET_BOOTSTRAP_MODE=scan
POLYMARKET_STATE_FILE=/absolute/path/to/polymarket-flow-sentinel.json
POLYMARKET_WEBHOOK_URL=
HOST=0.0.0.0
PORT=3000
```

메모:

- `POLYMARKET_BOOTSTRAP_MODE=scan`이면 최근 블록을 백필해서 바로 후보를 찾습니다.
- `POLYMARKET_BOOTSTRAP_MODE=skip`이면 현재 최신 블록만 기준점으로 잡고 다음 폴부터 감시합니다.
- `POLYMARKET_MIN_TRADE_USD=0`이면 첫 거래는 금액과 무관하게 기록합니다.
- `POLYMARKET_ACTIVITY_PAGE_*`는 funding 이후 지갑별 Polymarket 거래 이력을 얼마나 깊게 긁을지 정합니다.
- `POLYMARKET_PRICE_CACHE_MS`는 변동성 자산의 USD 가격 캐시 시간을 정합니다.

### 알림 단계

- `funding`: fresh wallet 대규모 funding 감지
- `first-use`: Polymarket 관련 승인 또는 첫 activity
- `first-trade`: 해당 지갑의 첫 실제 Polymarket 배팅

### 탐지 메모

- Polymarket 공개 activity API와 Polygon RPC를 함께 사용합니다.
- 첫 사용 신호는 Polymarket 공식 배포 주소에 대한 승인 이벤트와 wallet-specific activity를 같이 봅니다.
- 같은 트랜잭션 안에서 중간 계약으로 바로 흘러가는 pass-through transfer는 funding 후보에서 제외합니다.
- 변동성 자산은 외부 가격 API로 USD 환산합니다.
- state를 유지한 채 계속 실행하면 단순 최근 거래창 감시보다 훨씬 안정적으로 funding-to-bet 흐름을 잡을 수 있습니다.
