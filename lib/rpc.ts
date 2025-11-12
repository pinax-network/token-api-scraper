import { TronWeb } from "tronweb";
import { keccak256, toUtf8Bytes, AbiCoder } from "ethers"; // ethers v6+
import { sleep } from "bun";

/** -----------------------------------------------------------------------
 *  Config
 *  ---------------------------------------------------------------------*/
const DEFAULT_RETRIES = 3;
const NODE_URL = process.env.NODE_URL || "https://tron-evm-rpc.publicnode.com";

/** -----------------------------------------------------------------------
 *  Error + Retry helpers (from your reference)
 *  ---------------------------------------------------------------------*/
class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableError";
  }
}

const lc = (s: any) => String(s || "").toLowerCase();

function isRetryable(e?: any, status?: number, json?: any) {
  const msg = lc(e?.message || e);
  const jmsg = lc(json?.error?.message);
  const code = json?.error?.code;

  // Transport / fetch layer
  if (
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("enotfound") ||
    msg.includes("socket hang up") ||
    msg.includes("operation was aborted") || // AbortController
    msg.includes("fetch failed") ||
    msg.includes("aborterror")               // Bun/WHATWG
  ) return true;

  // HTTP: add more transient statuses (LB/CDN etc.)
  if (status) {
    if ([408, 425, 429, 499, 502, 503, 504, 522, 523, 524].includes(status)) return true;
    if (status >= 500) return true;
  }

  // JSON-RPC codes & flaky messages
  // Known transient-ish codes
  if (typeof code === "number" && [-32000, -32001, -32002, -32603].includes(code)) return true;

  // IMPORTANT: some TRON nodes behind LBs return -32600 with a capability message
  // Example: "this node does not support constant"
  if (code === -32600 && (jmsg.includes("does not support constant") || jmsg.includes("unsupported") || jmsg.includes("method not found"))) {
    return true; // retry to hit a different backend node
  }

  // Other bursty/overload messages
  if (
    jmsg.includes("too many requests") ||
    jmsg.includes("rate limit") ||
    jmsg.includes("temporarily unavailable") ||
    jmsg.includes("timeout") ||
    jmsg.includes("busy") ||
    jmsg.includes("overloaded") ||
    jmsg.includes("try again")
  ) return true;

  // Non-JSON / HTML/empty body parsing errors bubble in as generic exceptions
  if (msg.includes("unexpected token") || msg.includes("failed to parse") || msg.includes("non-json")) return true;

  return false;
}

function toOptions(
  retryOrOpts?: number | { retries?: number; baseDelayMs?: number; timeoutMs?: number; }
) {
  if (typeof retryOrOpts === "number") {
    return { retries: retryOrOpts, baseDelayMs: 400, timeoutMs: 10_000 };
  }
  return {
    retries: retryOrOpts?.retries ?? DEFAULT_RETRIES,
    baseDelayMs: retryOrOpts?.baseDelayMs ?? 400,
    timeoutMs: retryOrOpts?.timeoutMs ?? 10_000
  };
}

/** -----------------------------------------------------------------------
 *  ABI + TRON address helpers (new)
 *  ---------------------------------------------------------------------*/
export const abi = AbiCoder.defaultAbiCoder();

// Accepts TRON base58 ("T...") or 0x-hex, returns 0x-hex (20-byte EVM)
const toEvmHexAddress = (a: string) => {
  if (!a) throw new Error("empty address");
  if (a.startsWith("0x")) return a.toLowerCase();
  const hex = TronWeb.address.toHex(a);           // "41" + 20-byte hex
  return ("0x" + hex.replace(/^41/i, "")).toLowerCase();
};

// Extract ["type1","type2",...] from "fn(type1,type2)"
const parseTypesFromSignature = (signature: string): string[] => {
  const m = signature.match(/\((.*)\)/);
  if (!m) return [];
  const inside = m[1].trim();
  if (!inside) return [];
  return inside.split(",").map(s => s.trim());
};

// Normalize JS values to what ethers encoder expects (esp. addresses)
const normalizeForType = (type: string, value: any) => {
  const t = type.toLowerCase();
  if (t === "address") return toEvmHexAddress(String(value));
  if (t.startsWith("address[")) return (value || []).map((v: any) => toEvmHexAddress(String(v)));
  // Leave numbers/uints/bytes/etc. as provided (ethers v6 handles bigint/strings)
  return value;
};

/** -----------------------------------------------------------------------
 *  Generic JSON-RPC call with retry logic
 *  ---------------------------------------------------------------------*/
async function makeJsonRpcCall(
  method: string,
  params: any[],
  retryOrOpts?: number | { retries?: number; baseDelayMs?: number; timeoutMs?: number; },
  errorContext?: string
): Promise<string> {
  const { retries, baseDelayMs, timeoutMs } = toOptions(retryOrOpts);

  const body = {
    jsonrpc: "2.0",
    method,
    params,
    id: 1
  };

  const attempts = Math.max(1, retries);
  let lastError: any;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch(NODE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });

      let json: any = null;
      try {
        json = await res.json();
      } catch (parseErr) {
        // Non-JSON or empty response
        if (isRetryable(parseErr, res.status)) {
          throw new RetryableError(`Non-JSON response (status ${res.status})`);
        }
        throw new Error(`Failed to parse JSON (status ${res.status})`);
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        if (isRetryable(null, res.status, json)) {
          throw new RetryableError(`HTTP ${res.status}`);
        }
        throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
      }

      if (json?.error) {
        if (isRetryable(null, res.status, json)) {
          throw new RetryableError(`RPC error ${json.error.code}: ${json.error.message}`);
        }
        throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
      }

      return json?.result || "";

    } catch (err: any) {
      clearTimeout(timer);
      lastError = err;

      const retryable = err instanceof RetryableError || isRetryable(err);
      if (!retryable || attempt === attempts) {
        // Bubble up final error or non-retryable error
        throw err;
      }

      // Exponential backoff with jitter
      const backoffMs = Math.floor(baseDelayMs * Math.pow(2, attempt - 1));
      const jitter = Math.floor(backoffMs * (0.7 + Math.random() * 0.6)); // 70%–130%
      const delay = Math.min(30_000, jitter); // cap individual delay
      await sleep(delay);
      continue;
    }
  }

  // Shouldn't reach here
  throw lastError ?? new Error(`Unknown error in JSON-RPC call${errorContext ? `: ${errorContext}` : ""}`);
}

/** -----------------------------------------------------------------------
 *  callContract (now supports args, but stays backward compatible)
 *  ---------------------------------------------------------------------*/

// Overloads for TS ergonomics:
// 1) Old style: callContract(contract, "decimals()", retryOrOpts?)
// 2) New style: callContract(contract, "balanceOf(address)", [holder], retryOrOpts?)
type RetryOpts = number | { retries?: number; baseDelayMs?: number; timeoutMs?: number; };

export async function callContract(
  contract: string,
  signature: string,
  retryOrOpts?: RetryOpts
): Promise<string>;
export async function callContract(
  contract: string,
  signature: string,
  args: any[],
  retryOrOpts?: RetryOpts
): Promise<string>;
export async function callContract(
  contract: string,
  signature: string,
  a3?: any,
  a4?: any
): Promise<string> {
  // Interpret parameters for backward compatibility
  let args: any[] = [];
  let retryOrOpts: RetryOpts | undefined;

  if (Array.isArray(a3)) {
    args = a3;
    retryOrOpts = a4;
  } else {
    retryOrOpts = a3;
  }

  // 4-byte selector
  const selector = "0x" + keccak256(toUtf8Bytes(signature)).slice(2, 10);

  // Contract address: TRON base58 -> 0xEVM (strip 41 prefix)
  const to = `0x${TronWeb.address.toHex(contract).replace(/^41/i, "")}`;

  // ABI-encode args (if any)
  const types = parseTypesFromSignature(signature);
  if (types.length !== (args?.length ?? 0)) {
    throw new Error(`Arg count mismatch for ${signature}: expected ${types.length}, got ${args?.length ?? 0}`);
  }

  const normArgs = (args ?? []).map((v, i) => normalizeForType(types[i], v));
  const encodedArgs = types.length ? abi.encode(types, normArgs) : "0x";
  const data = selector + encodedArgs.replace(/^0x/, "");

  const hexValue = await makeJsonRpcCall(
    "eth_call",
    [{ to, data }, "latest"],
    retryOrOpts,
    `calling ${signature} on ${contract}`
  );

  // Treat "0x" (empty) as no result, and preserve your original return convention
  if (!hexValue || hexValue.toLowerCase() === "0x") {
    return "";
  }

  return hexValue.replace(/^0x/, "");
}

// If you want a numeric result for uint256:
export function decodeUint256(hexNo0x: string): bigint {
  const bytes = "0x" + hexNo0x.replace(/^0x/, "");
  const [val] = abi.decode(["uint256"], bytes);
  return val;
}

/** -----------------------------------------------------------------------
 *  getNativeBalance - Get native TRX balance for an account
 *  ---------------------------------------------------------------------*/
export async function getNativeBalance(
  account: string,
  retryOrOpts?: RetryOpts
): Promise<string> {
  // Convert TRON base58 address to EVM hex format
  const address = toEvmHexAddress(account);

  const hexValue = await makeJsonRpcCall(
    "eth_getBalance",
    [address, "latest"],
    retryOrOpts,
    `getting balance for ${account}`
  );

  // Treat "0x" (empty) or "0x0" as zero balance
  if (!hexValue || hexValue.toLowerCase() === "0x" || hexValue.toLowerCase() === "0x0") {
    return "0";
  }

  return hexValue.replace(/^0x/, "");
}