export const POLYMARKET_CONTRACTS = Object.freeze({
  usdc: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  conditionalTokens: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
  ctfExchange: "0x4bFb41d5B3570DeFd03C39a9A4d8dE6bd8B8982E",
  negRiskCtfExchange: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  negRiskAdapter: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
  proxyFactory: "0xaB45c5A4B0c941a2F231C04C3f49182e1A254052",
  safeFactory: "0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b"
});

export const EVENT_SIGNATURES = Object.freeze({
  erc20Transfer: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  erc20Approval: "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
  erc1155ApprovalForAll: "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31"
});

export const FIRST_USE_CONTRACTS = Object.freeze({
  usdcApprovalSpenders: [POLYMARKET_CONTRACTS.conditionalTokens.toLowerCase()],
  approvalForAllOperators: [
    POLYMARKET_CONTRACTS.ctfExchange.toLowerCase(),
    POLYMARKET_CONTRACTS.negRiskCtfExchange.toLowerCase()
  ]
});
