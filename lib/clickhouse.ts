import { type ClickHouseClient, createClient } from '@clickhouse/client';
import { createLogger } from './logger';

const log = createLogger('clickhouse');

// Lazy initialization of ClickHouse clients to allow CLI to set env vars first
let _client: ClickHouseClient | null = null;
let _insertClient: ClickHouseClient | null = null;

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
 * Get the ClickHouse client for read operations (SELECT queries) and DDL commands
 * Uses CLICKHOUSE_DATABASE
 */
function getClient(): ClickHouseClient {
    if (!_client) {
        _client = createClient({
            url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
            username: process.env.CLICKHOUSE_USERNAME || 'default',
            password: process.env.CLICKHOUSE_PASSWORD || '',
            database: process.env.CLICKHOUSE_DATABASE,
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
        });
    }
    return _insertClient;
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
        // Close both clients concurrently
        return async () => {
            await Promise.all([getClient().close(), getInsertClient().close()]);
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
        // Track query execution time
        const queryStartTime = performance.now();
        const resultSet = await client.query({
            query,
            query_params,
            format: 'JSONEachRow',
        });
        const queryEndTime = performance.now();

        // Track data parsing time
        const parseStartTime = performance.now();
        const data: T[] = await resultSet.json();
        const parseEndTime = performance.now();

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
