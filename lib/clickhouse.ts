import { createClient } from '@clickhouse/client';

export const client = createClient({
    url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USERNAME || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    database: process.env.CLICKHOUSE_DATABASE || 'default',
});

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

export async function query<T = any>(query: string, query_params: Record<string, any> = {}): Promise<{
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
        const httpRequestTimeMs = Math.round((queryEndTime - queryStartTime) * 100) / 100;
        const dataFetchTimeMs = Math.round((parseEndTime - parseStartTime) * 100) / 100;
        const totalTimeMs = Math.round((endTime - startTime) * 100) / 100;

        return {
            data,
            metrics: {
                httpRequestTimeMs,
                dataFetchTimeMs,
                totalTimeMs,
            },
        };
    } catch (error: unknown) {
        // Enhanced error logging with connection details
        const url = process.env.CLICKHOUSE_URL || 'http://localhost:8123';
        const urlObj = new URL(url);
        const host = urlObj.hostname;

        const err = error as Error & { cause?: { code?: string; message?: string } };

        console.error('\n=== ClickHouse Connection Error ===');
        console.error('Connection URL:', url);
        console.error('Host:', host);
        console.error('Error Type:', err.constructor.name);
        console.error('Error Message:', err.message);

        if (err.cause) {
            console.error('Error Cause:', err.cause);
            if (err.cause.code) {
                console.error('Error Code:', err.cause.code);
            }
            if (err.cause.message) {
                console.error('Cause Message:', err.cause.message);
            }
        }

        // Log timeout information if available
        if (err.message && err.message.includes('timeout')) {
            console.error('Timeout Details: Connection timeout occurred');
            console.error('Attempted Address:', `${host}:${urlObj.port || (urlObj.protocol === 'https:' ? 443 : 8123)}`);
        }

        console.error('Stack Trace:', err.stack);
        console.error('===================================\n');

        // Re-throw with enhanced message
        throw new Error(`Failed to connect to ClickHouse at ${url}: ${err.message}`);
    }
}