import { EVENT_SIGNATURES } from "./polymarket-address-book.js";

function hexToNumber(value) {
  return Number.parseInt(value ?? "0x0", 16);
}

function hexToBigInt(value) {
  return BigInt(value ?? "0x0");
}

function numberToHex(value) {
  return `0x${value.toString(16)}`;
}

function normalizeAddress(value) {
  if (!value) {
    return "";
  }

  return `0x${value.slice(-40).toLowerCase()}`;
}

function addressTopic(address) {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

function formatUnits(rawValue, decimals) {
  return Number(rawValue) / 10 ** decimals;
}

function decodeBoolean(value) {
  return hexToBigInt(value) !== 0n;
}

async function fetchJson(url, payload, timeoutMs, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "user-agent": "polymarket-flow-sentinel/1.0.0"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for RPC ${payload.method}.`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function decodeErc20TransferLog(log, decimals = 6) {
  return {
    type: "transfer",
    from: normalizeAddress(log.topics?.[1]),
    to: normalizeAddress(log.topics?.[2]),
    valueRaw: hexToBigInt(log.data),
    value: formatUnits(hexToBigInt(log.data), decimals),
    transactionHash: log.transactionHash,
    blockNumber: hexToNumber(log.blockNumber),
    logIndex: hexToNumber(log.logIndex)
  };
}

export function decodeErc20ApprovalLog(log, decimals = 6) {
  return {
    type: "approval",
    owner: normalizeAddress(log.topics?.[1]),
    spender: normalizeAddress(log.topics?.[2]),
    valueRaw: hexToBigInt(log.data),
    value: formatUnits(hexToBigInt(log.data), decimals),
    transactionHash: log.transactionHash,
    blockNumber: hexToNumber(log.blockNumber),
    logIndex: hexToNumber(log.logIndex)
  };
}

export function decodeErc1155ApprovalForAllLog(log) {
  return {
    type: "approvalForAll",
    account: normalizeAddress(log.topics?.[1]),
    operator: normalizeAddress(log.topics?.[2]),
    approved: decodeBoolean(log.data),
    transactionHash: log.transactionHash,
    blockNumber: hexToNumber(log.blockNumber),
    logIndex: hexToNumber(log.logIndex)
  };
}

export class PolygonRpcClient {
  constructor({ rpcUrl, timeoutMs, fetchImpl = fetch }) {
    this.rpcUrl = rpcUrl;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.requestId = 0;
    this.blockCache = new Map();
  }

  async rpc(method, params) {
    this.requestId += 1;
    const payload = {
      jsonrpc: "2.0",
      id: this.requestId,
      method,
      params
    };
    const data = await fetchJson(this.rpcUrl, payload, this.timeoutMs, this.fetchImpl);

    if (data?.error) {
      throw new Error(`RPC ${method} failed: ${data.error.message ?? JSON.stringify(data.error)}`);
    }

    return data.result;
  }

  async getBlockNumber() {
    const blockNumber = await this.rpc("eth_blockNumber", []);
    return hexToNumber(blockNumber);
  }

  async getCode(address) {
    return this.rpc("eth_getCode", [address, "latest"]);
  }

  async getBlock(blockNumber) {
    if (this.blockCache.has(blockNumber)) {
      return this.blockCache.get(blockNumber);
    }

    const block = await this.rpc("eth_getBlockByNumber", [numberToHex(blockNumber), false]);
    const parsed = {
      number: hexToNumber(block.number),
      timestamp: hexToNumber(block.timestamp),
      hash: block.hash
    };

    this.blockCache.set(blockNumber, parsed);
    return parsed;
  }

  async getBlockWithTransactions(blockNumber) {
    const block = await this.rpc("eth_getBlockByNumber", [numberToHex(blockNumber), true]);

    return {
      number: hexToNumber(block.number),
      timestamp: hexToNumber(block.timestamp),
      hash: block.hash,
      transactions: Array.isArray(block.transactions)
        ? block.transactions.map((transaction) => ({
            hash: transaction.hash,
            from: normalizeAddress(transaction.from),
            to: normalizeAddress(transaction.to),
            valueRaw: hexToBigInt(transaction.value),
            value: formatUnits(hexToBigInt(transaction.value), 18),
            blockNumber: hexToNumber(transaction.blockNumber),
            transactionIndex: hexToNumber(transaction.transactionIndex)
          }))
        : []
    };
  }

  async getBlockTimestamp(blockNumber) {
    const block = await this.getBlock(blockNumber);
    return block.timestamp;
  }

  async getLogs({ fromBlock, toBlock, address, topics }) {
    return this.rpc("eth_getLogs", [
      {
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(toBlock),
        address,
        topics
      }
    ]);
  }

  async getUsdcTransferLogs({ fromBlock, toBlock, address }) {
    const logs = await this.getLogs({
      fromBlock,
      toBlock,
      address,
      topics: [EVENT_SIGNATURES.erc20Transfer]
    });

    return logs.map((log) => decodeErc20TransferLog(log));
  }

  async getErc20TransferLogs({ fromBlock, toBlock, address, decimals }) {
    const logs = await this.getLogs({
      fromBlock,
      toBlock,
      address,
      topics: [EVENT_SIGNATURES.erc20Transfer]
    });

    return logs.map((log) => decodeErc20TransferLog(log, decimals));
  }

  async getUsdcApprovalLogs({ fromBlock, toBlock, address, spender }) {
    const logs = await this.getLogs({
      fromBlock,
      toBlock,
      address,
      topics: [EVENT_SIGNATURES.erc20Approval, null, spender ? addressTopic(spender) : null]
    });

    return logs.map((log) => decodeErc20ApprovalLog(log));
  }

  async getApprovalForAllLogs({ fromBlock, toBlock, address }) {
    const logs = await this.getLogs({
      fromBlock,
      toBlock,
      address,
      topics: [EVENT_SIGNATURES.erc1155ApprovalForAll]
    });

    return logs.map((log) => decodeErc1155ApprovalForAllLog(log));
  }

  async getNativeTransfers({ fromBlock, toBlock }) {
    const transfers = [];

    for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += 1) {
      const block = await this.getBlockWithTransactions(blockNumber);

      for (const transaction of block.transactions) {
        if (!transaction.to || transaction.valueRaw === 0n) {
          continue;
        }

        transfers.push({
          type: "native-transfer",
          from: transaction.from,
          to: transaction.to,
          valueRaw: transaction.valueRaw,
          value: transaction.value,
          transactionHash: transaction.hash,
          blockNumber: transaction.blockNumber,
          logIndex: transaction.transactionIndex
        });
      }
    }

    return transfers;
  }
}
