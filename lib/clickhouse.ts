import { type ClickHouseClient, createClient } from '@clickhouse/client';
import { CLICKHOUSE_REQUEST_TIMEOUT_MS } from './config';
import { createLogger } from './logger';
import { trackClickHouseOperation } from './prometheus';

const log = createLogger('clickhouse');

// Lazy initialization of ClickHouse clients to allow CLI to set env vars first
let _client: ClickHouseClient | null = null;
let _insertClient: ClickHouseClient | null = null;
let _setupClient: ClickHouseClient | null = null;

/**
 * Run a ClickHouse call with a deadline that is enforced here, not by the client.
 *
 * clickhouse-js relies on the node:http ClientRequest emitting 'abort' / 'timeout'
 * to settle its promise. On Bun neither fires once the response headers have
 * arrived, so a body that stalls mid-stream leaves `await resultSet.json()`
 * pending forever while the event loop (and the liveness probe) stay healthy.
 * This happened to the bsc metadata scraper a couple of times a week: its last
 * log line was "Querying database", the query had finished server-side, and the
 * pod sat idle until it was deleted by hand.
 *
 * The timer rejects on its own, aborts the in-flight request for clients that do
 * honour it, and discards the client instance the operation ran on so the next
 * call opens a fresh connection instead of queueing behind the dead one. Only
 * that instance is touched: the other pool keeps serving, and a late timer from
 * an old request cannot close the replacement that has since taken its place.
 */
export async function withDeadline<T>(
    slot: ClientSlot,
    run: (signal: AbortSignal) => Promise<T>,
    ms: number,
    what: string,
): Promise<T> {
    const instance = slot === 'read' ? getClient() : getInsertClient();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            const err = new Error(`ClickHouse ${what} timed out after ${ms}ms`);
            controller.abort(err);
            discardClient(slot, instance);
            reject(err);
        }, ms);
    });
    try {
        return await Promise.race([run(controller.signal), deadline]);
    } finally {
        clearTimeout(timer);
    }
}

type ClientSlot = 'read' | 'insert';

/**
 * Forget one cached client so a connection that stopped responding is never
 * reused. The slot is cleared only while it still holds this instance. close()
 * is not awaited: on a hung socket it may never settle.
 */
function discardClient(slot: ClientSlot, instance: ClickHouseClient): void {
    instance.close().catch(() => {});
    if (slot === 'read' && _client === instance) {
        _client = null;
    }
    if (slot === 'insert' && _insertClient === instance) {
        _insertClient = null;
    }
}

/**
 * Get the database name for insert operations
 * Falls back to CLICKHOUSE_DATABASE if CLICKHOUSE_DATABASE_INSERT is not set
 */
function getInsertDatabase(): string | undefined {
    return (
        process.env.CLICKHOUSE_DATABASE_INSERT ||
        process.env.CLICKHOUSE_DATABASE
    );
}

/**
 * Get the ClickHouse client for read operations (SELECT queries)
 * Uses CLICKHOUSE_DATABASE
 */
function getClient(): ClickHouseClient {
    if (!_client) {
        _client = createClient({
            url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
            username: process.env.CLICKHOUSE_USERNAME || 'default',
            password: process.env.CLICKHOUSE_PASSWORD || '',
            database: process.env.CLICKHOUSE_DATABASE,
            request_timeout: CLICKHOUSE_REQUEST_TIMEOUT_MS,
        });
    }
    return _client;
}

/**
 * Get the ClickHouse client for insert operations
 * Uses CLICKHOUSE_DATABASE_INSERT or falls back to CLICKHOUSE_DATABASE
 */
function getInsertClient(): ClickHouseClient {
    if (!_insertClient) {
        _insertClient = createClient({
            url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
            username: process.env.CLICKHOUSE_USERNAME || 'default',
            password: process.env.CLICKHOUSE_PASSWORD || '',
            database: getInsertDatabase(),
            request_timeout: CLICKHOUSE_REQUEST_TIMEOUT_MS,
        });
    }
    return _insertClient;
}

/**
 * Get the ClickHouse client for setup/DDL operations (CREATE TABLE, etc.)
 * Uses CLICKHOUSE_DATABASE_INSERT if defined, otherwise CLICKHOUSE_DATABASE
 * This ensures tables are created in the same database where data will be inserted
 */
function getSetupClient(): ClickHouseClient {
    if (!_setupClient) {
        _setupClient = createClient({
            url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
            username: process.env.CLICKHOUSE_USERNAME || 'default',
            password: process.env.CLICKHOUSE_PASSWORD || '',
            database: getInsertDatabase(),
            request_timeout: CLICKHOUSE_REQUEST_TIMEOUT_MS,
        });
    }
    return _setupClient;
}

/**
 * Client for insert operations
 * Uses CLICKHOUSE_DATABASE_INSERT or falls back to CLICKHOUSE_DATABASE
 */
export const insertClient = {
    get insert() {
        return getInsertClient().insert.bind(getInsertClient());
    },
    get close() {
        return getInsertClient().close.bind(getInsertClient());
    },
};

/**
 * Client for setup/DDL operations (CREATE TABLE, ALTER TABLE, etc.)
 * Uses CLICKHOUSE_DATABASE_INSERT if defined, otherwise CLICKHOUSE_DATABASE
 * This ensures tables are created in the same database where data will be inserted
 */
export const setupClient = {
    get command() {
        return getSetupClient().command.bind(getSetupClient());
    },
    get query() {
        return getSetupClient().query.bind(getSetupClient());
    },
    get close() {
        return getSetupClient().close.bind(getSetupClient());
    },
};

/**
 * Default ClickHouse client for queries and commands
 * Uses CLICKHOUSE_DATABASE for reads and DDL, CLICKHOUSE_DATABASE_INSERT for inserts
 */
export const client = {
    get query() {
        return getClient().query.bind(getClient());
    },
    get command() {
        return getClient().command.bind(getClient());
    },
    get insert() {
        return getInsertClient().insert.bind(getInsertClient());
    },
    get close() {
        // Close all clients concurrently
        return async () => {
            const clients = [_client, _insertClient, _setupClient].filter(
                (client): client is ClickHouseClient => client !== null,
            );

            _client = null;
            _insertClient = null;
            _setupClient = null;

            await Promise.all(clients.map((client) => client.close()));
        };
    },
};

export interface TokenData {
    token: string;
    token_symbol: string;
    token_name: string;
    token_decimals: number;
    feed: string;
    is_stakable: boolean;
    is_active: boolean;
}

export interface QueryMetrics {
    httpRequestTimeMs: number;
    dataFetchTimeMs: number;
    totalTimeMs: number;
}

export async function query<T = any>(
    query: string,
    query_params: Record<string, any> = {},
): Promise<{
    data: T[];
    metrics: QueryMetrics;
}> {
    // Track total operation time
    const startTime = performance.now();

    try {
        // The deadline covers both the request and reading the body: a read is
        // only complete (and only counted as one) once the rows are in hand.
        const {
            data,
            queryStartTime,
            queryEndTime,
            parseStartTime,
            parseEndTime,
        } = await withDeadline(
            'read',
            async (signal) => {
                // Track query execution time
                const queryStartTime = performance.now();
                const resultSet = await client.query({
                    query,
                    query_params,
                    format: 'JSONEachRow',
                    abort_signal: signal,
                });
                const queryEndTime = performance.now();

                // Track data parsing time
                const parseStartTime = performance.now();
                const data: T[] = await resultSet.json();
                const parseEndTime = performance.now();
                return {
                    data,
                    queryStartTime,
                    queryEndTime,
                    parseStartTime,
                    parseEndTime,
                };
            },
            CLICKHOUSE_REQUEST_TIMEOUT_MS,
            'query',
        );
        trackClickHouseOperation('read', 'success', startTime);

        const endTime = performance.now();

        // Calculate times
        const httpRequestTimeMs =
            Math.round((queryEndTime - queryStartTime) * 100) / 100;
        const dataFetchTimeMs =
            Math.round((parseEndTime - parseStartTime) * 100) / 100;
        const totalTimeMs = Math.round((endTime - startTime) * 100) / 100;

        // DEBUG: Log query results
        log.debug('ClickHouse query completed', {
            rowCount: data.length,
            httpRequestTimeMs,
            dataFetchTimeMs,
            totalTimeMs,
        });

        return {
            data,
            metrics: {
                httpRequestTimeMs,
                dataFetchTimeMs,
                totalTimeMs,
            },
        };
    } catch (error: unknown) {
        trackClickHouseOperation('read', 'error', startTime);
        const url = process.env.CLICKHOUSE_URL || 'http://localhost:8123';
        const urlObj = new URL(url);
        const host = urlObj.hostname;

        const err = error as Error & {
            cause?: { code?: string; message?: string };
        };

        log.error('ClickHouse query failed', {
            url,
            host,
            errorType: err.constructor.name,
            message: err.message,
            cause: err.cause,
            isTimeout: err.message?.includes('timeout'),
            address: `${host}:${urlObj.port || (urlObj.protocol === 'https:' ? 443 : 8123)}`,
        });

        throw new Error(
            `Failed to connect to ClickHouse at ${url}: ${err.message}`,
        );
    }
}
