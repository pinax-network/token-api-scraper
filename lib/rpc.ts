import { TronWeb } from "tronweb"
import { keccak256, toUtf8Bytes } from "ethers";  // ethers v6+
import { sleep } from "bun";

const DEFAULT_RETRIES = 5;
const NODE_URL = process.env.NODE_URL || "https://tron-evm-rpc.publicnode.com";

// Add this tiny helper (top-level, near your imports)
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

function toOptions(retryOrOpts?: number | { retries?: number; baseDelayMs?: number; timeoutMs?: number; }) {
    if (typeof retryOrOpts === "number") {
        return { retries: retryOrOpts, baseDelayMs: 400, timeoutMs: 10_000 };
    }
    return {
        retries: retryOrOpts?.retries ?? DEFAULT_RETRIES,
        baseDelayMs: retryOrOpts?.baseDelayMs ?? 400,
        timeoutMs: retryOrOpts?.timeoutMs ?? 10_000
    };
}

// --- Replacement ---
export async function callContract(
    contract: string,
    signature: string,
    retryOrOpts: number | { retries?: number; baseDelayMs?: number; timeoutMs?: number } = DEFAULT_RETRIES
) {
    const { retries, baseDelayMs, timeoutMs } = toOptions(retryOrOpts);

    const hash = keccak256(toUtf8Bytes(signature));
    const selector = "0x" + hash.slice(2, 10);
    const to = `0x${TronWeb.address.toHex(contract).replace(/^41/, "")}`
    // console.log(`eth_call ${signature} (data=${selector}) ${contract} (to=${to})`);

    const body = {
        jsonrpc: "2.0",
        method: "eth_call",
        params: [
            {
                to,
                data: selector
            },
            "latest"
        ],
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

            const hexValue: string | undefined = json?.result;
            // Treat "0x" (empty) as no result
            if (!hexValue || hexValue.toLowerCase() === "0x") {
                throw new Error(`No result for ${signature} on ${contract}`);
            }

            // console.log(json);
            return hexValue;

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
            console.warn(
                `callContract retry ${attempt}/${attempts} for ${signature} on ${contract} after ${delay}ms: ${err?.message || err}`
            );
            await sleep(delay);
            continue;
        }
    }

    // Shouldn’t reach here, but just in case:
    throw lastError ?? new Error(`Unknown error calling ${signature} on ${contract}`);
}
