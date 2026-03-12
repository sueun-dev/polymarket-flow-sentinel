# Polymarket Flow Sentinel

`Polymarket Flow Sentinel`은 Polygon에서 새로 큰 자금이 들어온 지갑을 먼저 잡고, 그 지갑이 Polymarket에 처음 손대는 순간과 첫 배팅까지 이어서 추적하는 실시간 모니터링 대시보드입니다.

## Core signal

- Polygon funding asset 유입을 읽습니다.
- 현재 감시 자산은 `USDC.e`, `USDC`, `USDT`, `DAI`, `WETH`, `WBTC`, `SAND`, `POL`입니다.
- `>= $50,000` 이상 유입된 지갑만 watchlist에 올립니다.
- 이미 Polymarket 활동 이력이 있는 지갑은 제외합니다.
- `첫 승인`, `첫 activity`, `첫 TRADE`를 이어서 확인합니다.
- 첫 배팅이 잡히면 시장명, 포지션, 금액, funding 이후 누적 거래 규모를 같이 보여줍니다.
- 대시보드, 콘솔, 웹훅으로 동일한 이벤트를 전달합니다.

## Quick start

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000`으로 접속하면 됩니다.

CLI로 한 번만 스캔:

```bash
npm run track:once
```

## TypeScript

- 서버, 모니터, 테스트 코드는 모두 TypeScript로 전환되었습니다.
- 브라우저 클라이언트 소스는 `client/dashboard-client.ts`에 있고, `npm start`나 `npm run build:client` 시 `public/dashboard-client.js`로 생성됩니다.
- 타입 검사는 `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` 등을 켠 상태로 `npm run typecheck`에서 수행합니다.

## Environment variables

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

## Alert stages

- `funding`: fresh wallet 대규모 funding 감지
- `first-use`: Polymarket 관련 승인 또는 첫 activity
- `first-trade`: 해당 지갑의 첫 실제 Polymarket 배팅

## Detection notes

- Polymarket 공개 activity API와 Polygon RPC를 함께 사용합니다.
- 첫 사용 신호는 Polymarket 공식 배포 주소에 대한 승인 이벤트와 wallet-specific activity를 같이 봅니다.
- 같은 트랜잭션 안에서 중간 계약으로 바로 흘러가는 pass-through transfer는 funding 후보에서 제외합니다.
- 변동성 자산은 외부 가격 API로 USD 환산합니다.
- state를 유지한 채 계속 실행하면 단순 최근 거래창 감시보다 훨씬 안정적으로 funding-to-bet 흐름을 잡을 수 있습니다.
