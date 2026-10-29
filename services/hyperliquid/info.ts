import { DEFAULT_CONFIG } from '../../lib/config';
import { TransientUpstreamError } from '../../lib/errors';
import { createLogger } from '../../lib/logger';
import { incrementHttpErrors } from '../../lib/prometheus';

/**
 * Per-request timeout for Hyperliquid Info API calls. Without this, a stalled
 * TCP connection can hang the run loop indefinitely. Falls back to 30s if the
 * env override is missing, non-numeric, or non-positive — guards against
 * `parseInt('garbage')` ⇒ NaN ⇒ instant abort.
 */
const FETCH_TIMEOUT_MS = (() => {
    const parsed = Number.parseInt(
        process.env.HYPERLIQUID_FETCH_TIMEOUT_MS ?? '',
        10,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
})();

const log = createLogger('hyperliquid:info');

export interface InfoRetryOptions {
    /** Attempts after the first one. */
    retries: number;
    baseDelayMs: number;
    maxDelayMs: number;
}

/**
 * About 12s of backoff in total: enough to ride out a gateway restart or a DNS
 * blip without stretching the cycle. A longer outage surfaces as a
 * `TransientUpstreamError` and the runner tries again next cycle.
 */
export const DEFAULT_INFO_RETRY: InfoRetryOptions = {
    retries: 5,
    baseDelayMs: DEFAULT_CONFIG.BASE_DELAY_MS,
    maxDelayMs: DEFAULT_CONFIG.MAX_DELAY_MS,
};

// Mirrors lib/uri-fetch.ts isRetryable status set.
const RETRYABLE_STATUSES = new Set([
    408, 425, 429, 499, 502, 503, 504, 522, 523, 524,
]);

// Matched against the error's name, code and message. Unlike lib/uri-fetch.ts
// this leaves out ENOTFOUND: a name that does not resolve is almost always a
// wrong HYPERLIQUID_INFO_URL, which should crash loudly rather than be retried
// every cycle. EAI_AGAIN is the resolver saying "try again later".
const RETRYABLE_FETCH_ERRORS = [
    'eai_again',
    'econnrefused',
    'econnreset',
    'etimedout',
    'socket hang up',
    'socket connection was closed',
    'operation was aborted',
    'fetch failed',
    'aborterror',
];

function isRetryableFetchError(err: unknown): boolean {
    const e = err as { name?: unknown; code?: unknown; message?: unknown };
    const text =
        `${e?.name ?? ''} ${e?.code ?? ''} ${e?.message ?? err}`.toLowerCase();
    return RETRYABLE_FETCH_ERRORS.some((s) => text.includes(s));
}

/**
 * POST `body` to the Hyperliquid Info API and return the parsed response.
 *
 * Retries 5xx/429/timeouts and transport errors with exponential backoff. When
 * those retries run out the error is a `TransientUpstreamError`; any other
 * failure (a 4xx, a non-retryable 5xx, a bad URL) is thrown as a plain `Error`
 * on the first attempt.
 */
export async function postInfo<T>(
    infoUrl: string,
    body: { type: string } & Record<string, unknown>,
    retry: InfoRetryOptions = DEFAULT_INFO_RETRY,
): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        const canRetry = attempt < retry.retries;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let response: Response;
        try {
            response = await fetch(infoUrl, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (response.ok) {
                return (await response.json()) as T;
            }
        } catch (err) {
            if (!isRetryableFetchError(err)) throw err;
            const message = String((err as Error)?.message ?? err);
            if (!canRetry) {
                incrementHttpErrors(`info:${body.type}`, 'transport');
                throw new TransientUpstreamError(message, { cause: err });
            }
            log.warn('Hyperliquid /info transport error, retrying', {
                type: body.type,
                attempt,
                error: message,
            });
            await sleep(attempt, retry);
            continue;
        } finally {
            clearTimeout(timeout);
        }

        const message = `Hyperliquid /info returned HTTP ${response.status}`;
        const retryable = RETRYABLE_STATUSES.has(response.status);
        if (!retryable || !canRetry) {
            incrementHttpErrors(`info:${body.type}`, response.status);
            throw retryable
                ? new TransientUpstreamError(message)
                : new Error(message);
        }
        log.warn('Hyperliquid /info returned a retryable status, retrying', {
            type: body.type,
            status: response.status,
            attempt,
        });
        await sleep(attempt, retry);
    }
}

function sleep(attempt: number, retry: InfoRetryOptions): Promise<void> {
    const delay = Math.min(retry.baseDelayMs * 2 ** attempt, retry.maxDelayMs);
    return new Promise((r) => setTimeout(r, delay));
}
