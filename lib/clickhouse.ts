import { type ClickHouseClient, createClient } from '@clickhouse/client';
import { createLogger } from './logger';

const log = createLogger('clickhouse');

// Lazy initialization of ClickHouse clients to allow CLI to set env vars first
let _readClient: ClickHouseClient | null = null;
let _writeClient: ClickHouseClient | null = null;

/**
 * Get the database name for read operations
 * Falls back to CLICKHOUSE_DATABASE if CLICKHOUSE_DATABASE_READ is not set
 */
function getReadDatabase(): string | undefined {
    return (
        process.env.CLICKHOUSE_DATABASE_READ || process.env.CLICKHOUSE_DATABASE
    );
}

/**
 * Get the database name for write operations
 * Falls back to CLICKHOUSE_DATABASE if CLICKHOUSE_DATABASE_WRITE is not set
 */
function getWriteDatabase(): string | undefined {
    return (
        process.env.CLICKHOUSE_DATABASE_WRITE || process.env.CLICKHOUSE_DATABASE
    );
}

/**
 * Get the ClickHouse client for read operations (SELECT queries)
 */
function getReadClient(): ClickHouseClient {
    if (!_readClient) {
        _readClient = createClient({
            url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
            username: process.env.CLICKHOUSE_USERNAME || 'default',
            password: process.env.CLICKHOUSE_PASSWORD || '',
            database: getReadDatabase(),
        });
    }
    return _readClient;
}

/**
 * Get the ClickHouse client for write operations (INSERT, DDL)
 */
function getWriteClient(): ClickHouseClient {
    if (!_writeClient) {
        _writeClient = createClient({
            url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
            username: process.env.CLICKHOUSE_USERNAME || 'default',
            password: process.env.CLICKHOUSE_PASSWORD || '',
            database: getWriteDatabase(),
        });
    }
    return _writeClient;
}

/**
 * Client for read operations (SELECT queries)
 * Uses CLICKHOUSE_DATABASE_READ or falls back to CLICKHOUSE_DATABASE
 */
export const readClient = {
    get query() {
        return getReadClient().query.bind(getReadClient());
    },
    get close() {
        return getReadClient().close.bind(getReadClient());
    },
};

/**
 * Client for write operations (INSERT, DDL)
 * Uses CLICKHOUSE_DATABASE_WRITE or falls back to CLICKHOUSE_DATABASE
 */
export const writeClient = {
    get command() {
        return getWriteClient().command.bind(getWriteClient());
    },
    get insert() {
        return getWriteClient().insert.bind(getWriteClient());
    },
    get close() {
        return getWriteClient().close.bind(getWriteClient());
    },
};

/** @deprecated Use readClient for queries and writeClient for inserts/commands */
export const client = {
    get query() {
        return getReadClient().query.bind(getReadClient());
    },
    get command() {
        return getWriteClient().command.bind(getWriteClient());
    },
    get insert() {
        return getWriteClient().insert.bind(getWriteClient());
    },
    get close() {
        // Close both clients concurrently
        return async () => {
            await Promise.all([
                getReadClient().close(),
                getWriteClient().close(),
            ]);
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
        const resultSet = await readClient.query({
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
