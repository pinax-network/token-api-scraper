// Thin REST client for Kalshi Trade API v2. Public market-data endpoints only —
// no auth, no signing.

import { DEFAULT_CONFIG } from '../../lib/config';
import { logger } from '../../lib/logger';
import type {
    BulkCandlesPage,
    CandlesPage,
    EventsPage,
    HistoricalCutoff,
    MarketsPage,
    SeriesPage,
    TradesPage,
} from './types';

export const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';

export interface ClientOptions {
    baseUrl?: string;
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    requestTimeoutMs?: number;
}

const DEFAULTS: Required<ClientOptions> = {
    baseUrl: KALSHI_BASE,
    maxRetries: 5,
    baseDelayMs: DEFAULT_CONFIG.BASE_DELAY_MS,
    maxDelayMs: DEFAULT_CONFIG.MAX_DELAY_MS,
    // The lib default (100ms) is tuned for EVM RPCs; HTTP REST needs longer.
    requestTimeoutMs: 15_000,
};

// Mirrors lib/uri-fetch.ts isRetryable status set.
const RETRYABLE_STATUSES = new Set([
    408, 425, 429, 499, 502, 503, 504, 522, 523, 524,
]);
const RETRYABLE_FETCH_ERRORS = [
    'network',
    'econnreset',
    'etimedout',
    'enotfound',
    'socket hang up',
    'socket connection was closed',
    'operation was aborted',
    'fetch failed',
    'aborterror',
];

function isRetryableFetchError(err: unknown): boolean {
    const msg = String((err as Error)?.message || err || '').toLowerCase();
    return RETRYABLE_FETCH_ERRORS.some((s) => msg.includes(s));
}

export class KalshiClient {
    private readonly opts: Required<ClientOptions>;

    constructor(opts: ClientOptions = {}) {
        this.opts = { ...DEFAULTS, ...opts };
    }

    async get<T>(
        path: string,
        params: Record<string, string | number | boolean | undefined> = {},
    ): Promise<T> {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
            if (v == null || v === '') continue;
            qs.set(k, String(v));
        }
        const url = `${this.opts.baseUrl}${path}${qs.toString() ? `?${qs}` : ''}`;

        for (let attempt = 0; ; attempt++) {
            let resp: Response;
            try {
                resp = await fetch(url, {
                    signal: AbortSignal.timeout(this.opts.requestTimeoutMs),
                });
            } catch (err) {
                if (
                    isRetryableFetchError(err) &&
                    attempt < this.opts.maxRetries
                ) {
                    await this.sleep(attempt);
                    logger.warn('kalshi transport retry', {
                        url,
                        attempt,
                        err: String((err as Error)?.message || err),
                    });
                    continue;
                }
                throw err;
            }

            if (resp.ok) return (await resp.json()) as T;

            const retryable = RETRYABLE_STATUSES.has(resp.status);
            if (!retryable || attempt >= this.opts.maxRetries) {
                const body = await resp.text();
                throw new Error(
                    `Kalshi ${resp.status} on GET ${path}: ${body.slice(0, 240)}`,
                );
            }
            await this.sleep(attempt);
            logger.warn('kalshi retry', {
                url,
                status: resp.status,
                attempt,
            });
        }
    }

    private sleep(attempt: number): Promise<void> {
        const delay = Math.min(
            this.opts.baseDelayMs * 2 ** attempt,
            this.opts.maxDelayMs,
        );
        return new Promise((r) => setTimeout(r, delay));
    }

    getHistoricalCutoff(): Promise<HistoricalCutoff> {
        return this.get('/historical/cutoff');
    }

    /** Live (within-cutoff) trades. */
    getTradesLive(
        params: {
            ticker?: string;
            min_ts?: number;
            max_ts?: number;
            limit?: number;
            cursor?: string;
        } = {},
    ): Promise<TradesPage> {
        return this.get('/markets/trades', { limit: 1000, ...params });
    }

    /** Archived (before-cutoff) trades. */
    getTradesHistorical(
        params: {
            ticker?: string;
            min_ts?: number;
            max_ts?: number;
            limit?: number;
            cursor?: string;
        } = {},
    ): Promise<TradesPage> {
        return this.get('/historical/trades', { limit: 1000, ...params });
    }

    getMarkets(
        params: {
            status?: 'unopened' | 'open' | 'paused' | 'closed' | 'settled';
            event_ticker?: string;
            series_ticker?: string;
            tickers?: string;
            min_close_ts?: number;
            max_close_ts?: number;
            min_updated_ts?: number;
            limit?: number;
            cursor?: string;
        } = {},
    ): Promise<MarketsPage> {
        return this.get('/markets', { limit: 1000, ...params });
    }

    getEvents(
        params: {
            status?: 'unopened' | 'open' | 'closed' | 'settled';
            series_ticker?: string;
            min_close_ts?: number;
            min_updated_ts?: number;
            with_nested_markets?: boolean;
            limit?: number;
            cursor?: string;
        } = {},
    ): Promise<EventsPage> {
        return this.get('/events', { limit: 200, ...params });
    }

    getSeries(): Promise<SeriesPage> {
        return this.get('/series');
    }

    getCandlesticks(params: {
        series_ticker: string;
        market_ticker: string;
        start_ts: number;
        end_ts: number;
        period_interval: 1 | 60 | 1440;
    }): Promise<CandlesPage> {
        const { series_ticker, market_ticker, ...rest } = params;
        return this.get(
            `/series/${series_ticker}/markets/${market_ticker}/candlesticks`,
            rest,
        );
    }

    /**
     * Bulk candlesticks across up to 100 tickers per call, capped at 10K bars
     * total. Comma-separated `market_tickers`. Response uses `market_ticker`
     * (with prefix), distinct from the singular endpoint's `ticker`.
     */
    getBulkCandlesticks(params: {
        market_tickers: string[];
        start_ts: number;
        end_ts: number;
        period_interval: 1 | 60 | 1440;
    }): Promise<BulkCandlesPage> {
        return this.get('/markets/candlesticks', {
            market_tickers: params.market_tickers.join(','),
            start_ts: params.start_ts,
            end_ts: params.end_ts,
            period_interval: params.period_interval,
        });
    }
}
