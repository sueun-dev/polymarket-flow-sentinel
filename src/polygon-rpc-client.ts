import { EVENT_SIGNATURES } from "./polymarket-address-book.js";
import { isRecord, readArray, readString } from "./runtime-guards.js";

import type {
  DecodedApprovalForAllLog,
  DecodedApprovalLog,
  DecodedTransferLog,
  FetchLike,
  NativeTransfer,
  RpcBlock,
  RpcEnvelope,
  RpcLog,
  RpcTransaction
} from "./types.js";

interface PolygonRpcClientOptions {
  rpcUrl: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}

interface GetLogsInput {
  fromBlock: number;
  toBlock: number;
  address: string;
  topics: Array<string | null>;
}

interface GetTransferLogsInput {
  fromBlock: number;
  toBlock: number;
  address: string;
  decimals: number;
}

interface GetApprovalLogsInput {
  fromBlock: number;
  toBlock: number;
  address: string;
  spender?: string;
}

function hexToNumber(value: string | undefined): number {
  return Number.parseInt(value ?? "0x0", 16);
}

function hexToBigInt(value: string | undefined): bigint {
  return BigInt(value ?? "0x0");
}

function numberToHex(value: number): string {
  return `0x${value.toString(16)}`;
}

function normalizeAddress(value: string | undefined | null): string {
  if (!value) {
    return "";
  }

  return `0x${value.slice(-40).toLowerCase()}`;
}

function addressTopic(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

function formatUnits(rawValue: bigint, decimals: number): number {
  return Number(rawValue) / 10 ** decimals;
}

function decodeBoolean(value: string | undefined): boolean {
  return hexToBigInt(value) !== 0n;
}

function parseRpcEnvelope<T>(payload: unknown): RpcEnvelope<T> {
  if (!isRecord(payload)) {
    throw new Error("RPC response must be an object.");
  }

  return payload as RpcEnvelope<T>;
}

function parseRpcLogs(payload: unknown, method: string): RpcLog[] {
  return readArray(payload, `RPC ${method} result`).map((row, index) => {
    if (!isRecord(row)) {
      throw new Error(`RPC ${method} log ${index} must be an object.`);
    }

    return row as RpcLog;
  });
}

function parseRpcBlock(payload: unknown, includeTransactions: boolean): RpcBlock {
  if (!isRecord(payload)) {
    throw new Error(`RPC eth_getBlockByNumber result must be an object when includeTransactions=${String(includeTransactions)}.`);
  }

  return payload as RpcBlock;
}

async function fetchJson(
  url: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
  fetchImpl: FetchLike
): Promise<unknown> {
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
      throw new Error(`HTTP ${response.status} for RPC ${String(payload["method"])}.`);
    }

    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export function decodeErc20TransferLog(log: RpcLog, decimals = 6): DecodedTransferLog {
  return {
    type: "transfer",
    from: normalizeAddress(log.topics?.[1]),
    to: normalizeAddress(log.topics?.[2]),
    valueRaw: hexToBigInt(log.data),
    value: formatUnits(hexToBigInt(log.data), decimals),
    transactionHash: readString(log.transactionHash, "transfer transactionHash"),
    blockNumber: hexToNumber(log.blockNumber),
    logIndex: hexToNumber(log.logIndex)
  };
}

export function decodeErc20ApprovalLog(log: RpcLog, decimals = 6): DecodedApprovalLog {
  return {
    type: "approval",
    owner: normalizeAddress(log.topics?.[1]),
    spender: normalizeAddress(log.topics?.[2]),
    valueRaw: hexToBigInt(log.data),
    value: formatUnits(hexToBigInt(log.data), decimals),
    transactionHash: readString(log.transactionHash, "approval transactionHash"),
    blockNumber: hexToNumber(log.blockNumber),
    logIndex: hexToNumber(log.logIndex)
  };
}

export function decodeErc1155ApprovalForAllLog(log: RpcLog): DecodedApprovalForAllLog {
  return {
    type: "approvalForAll",
    account: normalizeAddress(log.topics?.[1]),
    operator: normalizeAddress(log.topics?.[2]),
    approved: decodeBoolean(log.data),
    transactionHash: readString(log.transactionHash, "approvalForAll transactionHash"),
    blockNumber: hexToNumber(log.blockNumber),
    logIndex: hexToNumber(log.logIndex)
  };
}

export class PolygonRpcClient {
  private readonly rpcUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private requestId = 0;
  private readonly blockCache = new Map<number, { number: number; timestamp: number; hash: string }>();

  constructor({ rpcUrl, timeoutMs, fetchImpl = fetch }: PolygonRpcClientOptions) {
    this.rpcUrl = rpcUrl;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    this.requestId += 1;
    const payload = {
      jsonrpc: "2.0",
      id: this.requestId,
      method,
      params
    };
    const response = parseRpcEnvelope<T>(await fetchJson(this.rpcUrl, payload, this.timeoutMs, this.fetchImpl));

    if (response.error) {
      throw new Error(`RPC ${method} failed: ${response.error.message ?? JSON.stringify(response.error)}`);
    }

    return response.result as T;
  }

  async getBlockNumber(): Promise<number> {
    return hexToNumber(await this.rpc<string>("eth_blockNumber", []));
  }

  async getCode(address: string): Promise<string> {
    return this.rpc<string>("eth_getCode", [address, "latest"]);
  }

  async getBlock(blockNumber: number): Promise<{ number: number; timestamp: number; hash: string }> {
    const cached = this.blockCache.get(blockNumber);

    if (cached) {
      return cached;
    }

    const block = parseRpcBlock(await this.rpc<unknown>("eth_getBlockByNumber", [numberToHex(blockNumber), false]), false);
    const parsed = {
      number: hexToNumber(block.number),
      timestamp: hexToNumber(block.timestamp),
      hash: readString(block.hash, "block hash")
    };

    this.blockCache.set(blockNumber, parsed);
    return parsed;
  }

  async getBlockWithTransactions(blockNumber: number): Promise<{
    number: number;
    timestamp: number;
    hash: string;
    transactions: Array<{
      hash: string;
      from: string;
      to: string;
      valueRaw: bigint;
      value: number;
      blockNumber: number;
      transactionIndex: number;
    }>;
  }> {
    const block = parseRpcBlock(await this.rpc<unknown>("eth_getBlockByNumber", [numberToHex(blockNumber), true]), true);
    const transactions = Array.isArray(block.transactions) ? block.transactions : [];

    return {
      number: hexToNumber(block.number),
      timestamp: hexToNumber(block.timestamp),
      hash: readString(block.hash, "block hash"),
      transactions: transactions.map((transaction: RpcTransaction, index) => ({
        hash: readString(transaction.hash, `block transaction ${index} hash`),
        from: normalizeAddress(transaction.from),
        to: normalizeAddress(transaction.to),
        valueRaw: hexToBigInt(transaction.value),
        value: formatUnits(hexToBigInt(transaction.value), 18),
        blockNumber: hexToNumber(transaction.blockNumber),
        transactionIndex: hexToNumber(transaction.transactionIndex)
      }))
    };
  }

  async getBlockTimestamp(blockNumber: number): Promise<number> {
    return (await this.getBlock(blockNumber)).timestamp;
  }

  async getLogs({ fromBlock, toBlock, address, topics }: GetLogsInput): Promise<RpcLog[]> {
    const rawLogs = await this.rpc<unknown>("eth_getLogs", [
      {
        fromBlock: numberToHex(fromBlock),
        toBlock: numberToHex(toBlock),
        address,
        topics
      }
    ]);

    return parseRpcLogs(rawLogs, "eth_getLogs");
  }

  async getUsdcTransferLogs({
    fromBlock,
    toBlock,
    address
  }: Omit<GetTransferLogsInput, "decimals">): Promise<DecodedTransferLog[]> {
    const logs = await this.getLogs({
      fromBlock,
      toBlock,
      address,
      topics: [EVENT_SIGNATURES.erc20Transfer]
    });

    return logs.map((log) => decodeErc20TransferLog(log));
  }

  async getErc20TransferLogs({
    fromBlock,
    toBlock,
    address,
    decimals
  }: GetTransferLogsInput): Promise<DecodedTransferLog[]> {
    const logs = await this.getLogs({
      fromBlock,
      toBlock,
      address,
      topics: [EVENT_SIGNATURES.erc20Transfer]
    });

    return logs.map((log) => decodeErc20TransferLog(log, decimals));
  }

  async getUsdcApprovalLogs({
    fromBlock,
    toBlock,
    address,
    spender
  }: GetApprovalLogsInput): Promise<DecodedApprovalLog[]> {
    const logs = await this.getLogs({
      fromBlock,
      toBlock,
      address,
      topics: [EVENT_SIGNATURES.erc20Approval, null, spender ? addressTopic(spender) : null]
    });

    return logs.map((log) => decodeErc20ApprovalLog(log));
  }

  async getApprovalForAllLogs({
    fromBlock,
    toBlock,
    address
  }: Omit<GetApprovalLogsInput, "spender">): Promise<DecodedApprovalForAllLog[]> {
    const logs = await this.getLogs({
      fromBlock,
      toBlock,
      address,
      topics: [EVENT_SIGNATURES.erc1155ApprovalForAll]
    });

    return logs.map((log) => decodeErc1155ApprovalForAllLog(log));
  }

  async getNativeTransfers({ fromBlock, toBlock }: { fromBlock: number; toBlock: number }): Promise<NativeTransfer[]> {
    const transfers: NativeTransfer[] = [];

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
