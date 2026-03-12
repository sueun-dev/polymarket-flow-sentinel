export const POLYMARKET_CONTRACTS = Object.freeze({
  usdc: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  conditionalTokens: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
  ctfExchange: "0x4bFb41d5B3570DeFd03C39a9A4d8dE6bd8B8982E",
  negRiskCtfExchange: "0xC5d563A36AE78145C45A50134d48A1215220cd76",
  negRiskAdapter: "0xd91E80cF2E4244fA58b8c325F90D4dE317EEa830",
  proxyFactory: "0xaB45c7F3f6D32b7a5D6B5C569bF76e4dF61fF62e"
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
