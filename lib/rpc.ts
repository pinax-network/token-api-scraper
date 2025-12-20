// Import proto polyfill first to fix tronweb protobuf issues
import './proto-polyfill';
import { sleep } from 'bun';
import { AbiCoder, keccak256, toUtf8Bytes } from 'ethers'; // ethers v6+
import PQueue from 'p-queue';
import { TronWeb } from 'tronweb';
import { NODE_URL } from './config';
import { createLogger } from './logger';

const log = createLogger('rpc');

/** -----------------------------------------------------------------------
 *  Config
 *  ---------------------------------------------------------------------*/
const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 400;
const DEFAULT_JITTER_MIN = 0.7; // 70% of backoff
const DEFAULT_JITTER_MAX = 1.3; // 130% of backoff
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 10_000;

// Read retry config from environment variables
const MAX_RETRIES = parseInt(
    process.env.MAX_RETRIES || String(DEFAULT_RETRIES),
    10,
);
const BASE_DELAY_MS = parseInt(
    process.env.BASE_DELAY_MS || String(DEFAULT_BASE_DELAY_MS),
    10,
);
const JITTER_MIN = parseFloat(
    process.env.JITTER_MIN || String(DEFAULT_JITTER_MIN),
);
const JITTER_MAX = parseFloat(
    process.env.JITTER_MAX || String(DEFAULT_JITTER_MAX),
);
const MAX_DELAY_MS = parseInt(
    process.env.MAX_DELAY_MS || String(DEFAULT_MAX_DELAY_MS),
    10,
);
const TIMEOUT_MS = parseInt(
    process.env.TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS),
    10,
);

/** -----------------------------------------------------------------------
 *  Error + Retry helpers (from your reference)
 *  ---------------------------------------------------------------------*/
class RetryableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RetryableError';
    }
}

const lc = (s: any) => String(s || '').toLowerCase();

function isRetryable(e?: any, status?: number, json?: any) {
    const msg = lc(e?.message || e);
    const jmsg = lc(json?.error?.message);
    const code = json?.error?.code;

    // Transport / fetch layer
    if (
        msg.includes('network') ||
        msg.includes('econnreset') ||
        msg.includes('etimedout') ||
        msg.includes('enotfound') ||
        msg.includes('socket hang up') ||
        msg.includes('operation was aborted') || // AbortController
        msg.includes('fetch failed') ||
        msg.includes('aborterror') // Bun/WHATWG
    )
        return true;

    // HTTP: add more transient statuses (LB/CDN etc.)
    if (status) {
        if ([408, 425, 429, 499, 502, 503, 504, 522, 523, 524].includes(status))
            return true;
        if (status >= 500) return true;
    }

    // JSON-RPC codes & flaky messages
    // Known transient-ish codes
    if (
        typeof code === 'number' &&
        [-32000, -32001, -32002, -32603].includes(code)
    )
        return true;

    // IMPORTANT: some EVM nodes behind LBs return -32600 with a capability message
    // Example: "this node does not support constant"
    if (
        code === -32600 &&
        (jmsg.includes('does not support constant') ||
            jmsg.includes('unsupported') ||
            jmsg.includes('method not found'))
    ) {
        return true; // retry to hit a different backend node
    }

    // Other bursty/overload messages
    if (
        jmsg.includes('too many requests') ||
        jmsg.includes('rate limit') ||
        jmsg.includes('temporarily unavailable') ||
        jmsg.includes('timeout') ||
        jmsg.includes('busy') ||
        jmsg.includes('overloaded') ||
        jmsg.includes('try again')
    )
        return true;

    // Non-JSON / HTML/empty body parsing errors bubble in as generic exceptions
    if (
        msg.includes('unexpected token') ||
        msg.includes('failed to parse') ||
        msg.includes('non-json')
    )
        return true;

    return false;
}

interface RetryOptions {
    retries?: number;
    baseDelayMs?: number;
    timeoutMs?: number;
    jitterMin?: number;
    jitterMax?: number;
    maxDelayMs?: number;
}

function toOptions(retryOrOpts?: number | RetryOptions) {
    if (typeof retryOrOpts === 'number') {
        return {
            retries: retryOrOpts,
            baseDelayMs: BASE_DELAY_MS,
            timeoutMs: TIMEOUT_MS,
            jitterMin: JITTER_MIN,
            jitterMax: JITTER_MAX,
            maxDelayMs: MAX_DELAY_MS,
        };
    }
    return {
        retries: retryOrOpts?.retries ?? MAX_RETRIES,
        baseDelayMs: retryOrOpts?.baseDelayMs ?? BASE_DELAY_MS,
        timeoutMs: retryOrOpts?.timeoutMs ?? TIMEOUT_MS,
        jitterMin: retryOrOpts?.jitterMin ?? JITTER_MIN,
        jitterMax: retryOrOpts?.jitterMax ?? JITTER_MAX,
        maxDelayMs: retryOrOpts?.maxDelayMs ?? MAX_DELAY_MS,
    };
}

/** -----------------------------------------------------------------------
 *  ABI + EVM address helpers
 *  ---------------------------------------------------------------------*/
export const abi = AbiCoder.defaultAbiCoder();

// Accepts base58 ("T...") or 0x-hex, returns 0x-hex (20-byte EVM)
const toEvmHexAddress = (a: string) => {
    if (!a) throw new Error('empty address');
    if (a.startsWith('0x')) return a.toLowerCase();
    const hex = TronWeb.address.toHex(a); // "41" + 20-byte hex
    return ('0x' + hex.replace(/^41/i, '')).toLowerCase();
};

// Extract ["type1","type2",...] from "fn(type1,type2)"
const parseTypesFromSignature = (signature: string): string[] => {
    const m = signature.match(/\((.*)\)/);
    if (!m) return [];
    const inside = m[1].trim();
    if (!inside) return [];
    return inside.split(',').map((s) => s.trim());
};

// Normalize JS values to what ethers encoder expects (esp. addresses)
const normalizeForType = (type: string, value: any) => {
    const t = type.toLowerCase();
    if (t === 'address') return toEvmHexAddress(String(value));
    if (t.startsWith('address['))
        return (value || []).map((v: any) => toEvmHexAddress(String(v)));
    // Leave numbers/uints/bytes/etc. as provided (ethers v6 handles bigint/strings)
    return value;
};

/** -----------------------------------------------------------------------
 *  Generic JSON-RPC call with retry logic
 *  ---------------------------------------------------------------------*/

/**
 * Execute a single JSON-RPC request without retry logic
 * This function performs one attempt at making an RPC call
 */
async function makeJsonRpcRequest(
    method: string,
    params: any[],
    timeoutMs: number,
): Promise<string> {
    const body = {
        jsonrpc: '2.0',
        method,
        params,
        id: 1,
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
        const res = await fetch(NODE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });

        let json: any = null;
        try {
            json = await res.json();
        } catch (parseErr) {
            // Non-JSON or empty response
            if (isRetryable(parseErr, res.status)) {
                throw new RetryableError(
                    `Non-JSON response (status ${res.status})`,
                );
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
                throw new RetryableError(
                    `RPC error ${json.error.code}: ${json.error.message}`,
                );
            }
            throw new Error(
                `RPC error ${json.error.code}: ${json.error.message}`,
            );
        }

        const result = json?.result || '';

        // DEBUG: Log RPC response details
        log.debug('RPC response received', {
            method,
            status: res.status,
            hasResult: !!result,
            resultLength: result.length,
        });

        return result;
    } catch (err: any) {
        clearTimeout(timer);
        throw err;
    }
}

/**
 * Make a JSON-RPC call with retry logic using p-queue
 * This function manages retries with exponential backoff and jitter
 */
async function makeJsonRpcCall(
    method: string,
    params: any[],
    retryOrOpts?: number | RetryOptions,
    errorContext?: string,
): Promise<string> {
    const {
        retries,
        baseDelayMs,
        timeoutMs,
        jitterMin,
        jitterMax,
        maxDelayMs,
    } = toOptions(retryOrOpts);

    const attempts = Math.max(1, retries);
    let lastError: any;

    // Create a queue with concurrency 1 for sequential retry attempts
    const queue = new PQueue({ concurrency: 1 });

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            // Use p-queue to manage the request
            const result = await queue.add(async () => {
                return await makeJsonRpcRequest(method, params, timeoutMs);
            });

            return result as string;
        } catch (err: any) {
            lastError = err;

            const retryable = err instanceof RetryableError || isRetryable(err);
            if (!retryable || attempt === attempts) {
                // Bubble up final error or non-retryable error
                throw err;
            }

            // Log retry warning
            log.warn('RPC request failed, retrying', {
                method,
                attempt,
                maxAttempts: attempts,
                error: err.message,
                endpoint: NODE_URL,
                context: errorContext,
            });

            // Exponential backoff with jitter
            const backoffMs = Math.floor(baseDelayMs * 2 ** (attempt - 1));
            const jitterRange = jitterMax - jitterMin;
            const jitter = Math.floor(
                backoffMs * (jitterMin + Math.random() * jitterRange),
            );
            const delay = Math.min(maxDelayMs, jitter);
            await sleep(delay);
        }
    }

    // Shouldn't reach here
    throw (
        lastError ??
        new Error(
            `Unknown error in JSON-RPC call${errorContext ? `: ${errorContext}` : ''}`,
        )
    );
}

/** -----------------------------------------------------------------------
 *  Batch JSON-RPC call support
 *  ---------------------------------------------------------------------*/

/**
 * Represents a single batch request item
 */
export interface BatchRequest {
    method: string;
    params: any[];
}

/**
 * Represents the result of a batch request item
 */
export interface BatchResult {
    success: boolean;
    result?: string;
    error?: {
        code: number;
        message: string;
    };
}

/**
 * Execute a batch JSON-RPC request without retry logic
 * This function performs one attempt at making a batch RPC call
 */
async function makeBatchJsonRpcRequest(
    requests: BatchRequest[],
    timeoutMs: number,
): Promise<BatchResult[]> {
    // Build batch request body according to JSON-RPC 2.0 spec
    const body = requests.map((req, index) => ({
        jsonrpc: '2.0',
        method: req.method,
        params: req.params,
        id: index + 1, // Use sequential IDs starting from 1
    }));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
        const res = await fetch(NODE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });

        let json: any = null;
        try {
            json = await res.json();
        } catch (parseErr) {
            // Non-JSON or empty response
            if (isRetryable(parseErr, res.status)) {
                throw new RetryableError(
                    `Non-JSON response (status ${res.status})`,
                );
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

        // Handle batch response - it should be an array
        if (!Array.isArray(json)) {
            throw new Error(
                `Expected array response for batch request, got: ${typeof json}`,
            );
        }

        // Map responses back to results, preserving order by ID
        const results: BatchResult[] = new Array(requests.length);

        for (const item of json) {
            const index = (item.id as number) - 1; // Convert back to 0-based index

            if (index < 0 || index >= requests.length) {
                log.warn('Received response with unexpected id', { id: item.id });
                continue;
            }

            if (item.error) {
                results[index] = {
                    success: false,
                    error: {
                        code: item.error.code,
                        message: item.error.message,
                    },
                };
            } else {
                results[index] = {
                    success: true,
                    result: item.result || '',
                };
            }
        }

        // Fill in any missing results (in case server didn't respond for some)
        for (let i = 0; i < results.length; i++) {
            if (!results[i]) {
                results[i] = {
                    success: false,
                    error: {
                        code: -1,
                        message: 'No response received for this request',
                    },
                };
            }
        }

        return results;
    } catch (err: any) {
        clearTimeout(timer);
        throw err;
    }
}

/**
 * Make a batch JSON-RPC call with retry logic
 * Returns an array of results, one for each request
 */
export async function makeBatchJsonRpcCall(
    requests: BatchRequest[],
    retryOrOpts?: number | RetryOptions,
): Promise<BatchResult[]> {
    if (!requests || requests.length === 0) {
        return [];
    }

    const {
        retries,
        baseDelayMs,
        timeoutMs,
        jitterMin,
        jitterMax,
        maxDelayMs,
    } = toOptions(retryOrOpts);

    const attempts = Math.max(1, retries);
    let lastError: any;

    // Create a queue with concurrency 1 for sequential retry attempts
    const queue = new PQueue({ concurrency: 1 });

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            // Use p-queue to manage the request
            const results = await queue.add(async () => {
                return await makeBatchJsonRpcRequest(requests, timeoutMs);
            });

            return results as BatchResult[];
        } catch (err: any) {
            lastError = err;

            const retryable = err instanceof RetryableError || isRetryable(err);
            if (!retryable || attempt === attempts) {
                // Bubble up final error or non-retryable error
                throw err;
            }

            // Log retry warning for batch requests
            log.warn('Batch RPC request failed, retrying', {
                requestCount: requests.length,
                attempt,
                maxAttempts: attempts,
                error: err.message,
                endpoint: NODE_URL,
            });

            // Exponential backoff with jitter
            const backoffMs = Math.floor(baseDelayMs * 2 ** (attempt - 1));
            const jitterRange = jitterMax - jitterMin;
            const jitter = Math.floor(
                backoffMs * (jitterMin + Math.random() * jitterRange),
            );
            const delay = Math.min(maxDelayMs, jitter);
            await sleep(delay);
        }
    }

    // Shouldn't reach here
    throw lastError ?? new Error(`Unknown error in batch JSON-RPC call`);
}

/** -----------------------------------------------------------------------
 *  callContract (now supports args, but stays backward compatible)
 *  ---------------------------------------------------------------------*/

// Overloads for TS ergonomics:
// 1) Old style: callContract(contract, "decimals()", retryOrOpts?)
// 2) New style: callContract(contract, "balanceOf(address)", [holder], retryOrOpts?)
type RetryOpts = number | RetryOptions;

export async function callContract(
    contract: string,
    signature: string,
    retryOrOpts?: RetryOpts,
): Promise<string>;
export async function callContract(
    contract: string,
    signature: string,
    args: any[],
    retryOrOpts?: RetryOpts,
): Promise<string>;
export async function callContract(
    contract: string,
    signature: string,
    a3?: any,
    a4?: any,
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
    const selector = '0x' + keccak256(toUtf8Bytes(signature)).slice(2, 10);

    // Contract address: EVM base58/hex conversion (strip 41 prefix if present)
    const to = toEvmHexAddress(contract);

    // ABI-encode args (if any)
    const types = parseTypesFromSignature(signature);
    if (types.length !== (args?.length ?? 0)) {
        throw new Error(
            `Arg count mismatch for ${signature}: expected ${types.length}, got ${args?.length ?? 0}`,
        );
    }

    const normArgs = (args ?? []).map((v, i) => normalizeForType(types[i], v));
    const encodedArgs = types.length ? abi.encode(types, normArgs) : '0x';
    const data = selector + encodedArgs.replace(/^0x/, '');

    const hexValue = await makeJsonRpcCall(
        'eth_call',
        [{ to, data }, 'latest'],
        retryOrOpts,
        `calling ${signature} on ${contract}`,
    );

    // Treat "0x" (empty) as no result, and preserve your original return convention
    if (!hexValue || hexValue.toLowerCase() === '0x') {
        return '';
    }

    // Keep the 0x prefix in the returned hex value
    return hexValue;
}

// If you want a numeric result for uint256:
export function decodeUint256(hexNo0x: string): bigint {
    const bytes = '0x' + hexNo0x.replace(/^0x/, '');
    const [val] = abi.decode(['uint256'], bytes);
    return val;
}

/** -----------------------------------------------------------------------
 *  getNativeBalance - Get native token balance for an account
 *  ---------------------------------------------------------------------*/
export async function getNativeBalance(
    account: string,
    retryOrOpts?: RetryOpts,
): Promise<string> {
    // Convert base58 address to EVM hex format
    const address = toEvmHexAddress(account);

    const hexValue = await makeJsonRpcCall(
        'eth_getBalance',
        [address, 'latest'],
        retryOrOpts,
        `getting balance for ${account}`,
    );

    // Treat "0x" (empty) or "0x0" as zero balance
    if (
        !hexValue ||
        hexValue.toLowerCase() === '0x' ||
        hexValue.toLowerCase() === '0x0'
    ) {
        return '0x0';
    }

    // Keep the 0x prefix in the returned hex value
    return hexValue;
}

/** -----------------------------------------------------------------------
 *  Batch contract call helpers
 *  ---------------------------------------------------------------------*/

/**
 * Represents a single contract call request for batch processing
 */
export interface ContractCallRequest {
    contract: string;
    signature: string;
    args?: any[];
}

/**
 * Represents the result of a batch contract call
 */
export interface ContractCallResult {
    success: boolean;
    result?: string;
    error?: string;
}

/**
 * Call multiple contracts in a single batch request
 * This is useful for fetching multiple contract values efficiently
 *
 * @param calls Array of contract calls to make
 * @param retryOrOpts Retry options or retry count
 * @returns Array of results, one for each call in the same order
 */
export async function batchCallContracts(
    calls: ContractCallRequest[],
    retryOrOpts?: RetryOpts,
): Promise<ContractCallResult[]> {
    if (!calls || calls.length === 0) {
        return [];
    }

    // Build batch requests
    const batchRequests: BatchRequest[] = calls.map((call) => {
        // 4-byte selector
        const selector =
            '0x' + keccak256(toUtf8Bytes(call.signature)).slice(2, 10);

        // Contract address: EVM base58/hex conversion (strip 41 prefix if present)
        const to = toEvmHexAddress(call.contract);

        // ABI-encode args (if any)
        const types = parseTypesFromSignature(call.signature);
        const args = call.args || [];

        if (types.length !== args.length) {
            throw new Error(
                `Arg count mismatch for ${call.signature}: expected ${types.length}, got ${args.length}`,
            );
        }

        const normArgs = args.map((v, i) => normalizeForType(types[i], v));
        const encodedArgs = types.length ? abi.encode(types, normArgs) : '0x';
        const data = selector + encodedArgs.replace(/^0x/, '');

        return {
            method: 'eth_call',
            params: [{ to, data }, 'latest'],
        };
    });

    // Execute batch request
    const batchResults = await makeBatchJsonRpcCall(batchRequests, retryOrOpts);

    // Map batch results to contract call results
    return batchResults.map((result, _index) => {
        if (!result.success) {
            return {
                success: false,
                error: result.error
                    ? `RPC error ${result.error.code}: ${result.error.message}`
                    : 'Unknown error',
            };
        }

        const hexValue = result.result || '';

        // Treat "0x" (empty) as empty result
        if (!hexValue || hexValue.toLowerCase() === '0x') {
            return {
                success: true,
                result: '',
            };
        }

        return {
            success: true,
            result: hexValue,
        };
    });
}

/**
 * Call multiple native balance requests in a single batch
 *
 * @param accounts Array of account addresses
 * @param retryOrOpts Retry options or retry count
 * @returns Array of results, one for each account in the same order
 */
export async function batchGetNativeBalances(
    accounts: string[],
    retryOrOpts?: RetryOpts,
): Promise<ContractCallResult[]> {
    if (!accounts || accounts.length === 0) {
        return [];
    }

    // Build batch requests
    const batchRequests: BatchRequest[] = accounts.map((account) => {
        const address = toEvmHexAddress(account);
        return {
            method: 'eth_getBalance',
            params: [address, 'latest'],
        };
    });

    // Execute batch request
    const batchResults = await makeBatchJsonRpcCall(batchRequests, retryOrOpts);

    // Map batch results to contract call results
    return batchResults.map((result) => {
        if (!result.success) {
            return {
                success: false,
                error: result.error
                    ? `RPC error ${result.error.code}: ${result.error.message}`
                    : 'Unknown error',
            };
        }

        const hexValue = result.result || '';

        // Treat "0x" (empty) or "0x0" as zero balance
        if (
            !hexValue ||
            hexValue.toLowerCase() === '0x' ||
            hexValue.toLowerCase() === '0x0'
        ) {
            return {
                success: true,
                result: '0x0',
            };
        }

        return {
            success: true,
            result: hexValue,
        };
    });
}
