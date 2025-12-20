/**
 * Central configuration file for environment variables
 * This module handles parsing and validation of environment variables used across all services
 */

/**
 * Enable verbose logging output
 * Default: false
 */
export const VERBOSE = process.env.VERBOSE === 'true';

/**
 * Logging level
 * Default: 'info'
 */
export const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info'

/**
 * Number of concurrent RPC requests
 * Default: 40
 */
export const CONCURRENCY = parseInt(process.env.CONCURRENCY || '40', 10);

/**
 * HTTP port for Prometheus metrics endpoint
 * Prometheus is always enabled
 * Default: 9090
 */
export const PROMETHEUS_PORT = parseInt(
    process.env.PROMETHEUS_PORT || '9090',
    10,
);

/**
 * Hostname for Prometheus server to bind to
 * Default: '0.0.0.0' (all interfaces)
 */
export const PROMETHEUS_HOSTNAME = process.env.PROMETHEUS_HOSTNAME || '0.0.0.0';

/**
 * Interval in milliseconds to flush batch inserts
 * Default: 1000ms (1 second)
 */
export const BATCH_INSERT_INTERVAL_MS = parseInt(
    process.env.BATCH_INSERT_INTERVAL_MS || '1000',
    10,
);

/**
 * Maximum number of rows in a batch before forcing a flush
 * Default: 10000
 */
export const BATCH_INSERT_MAX_SIZE = parseInt(
    process.env.BATCH_INSERT_MAX_SIZE || '10000',
    10,
);

export const CLICKHOUSE_URL =
    process.env.CLICKHOUSE_URL || 'http://localhost:8123';
export const CLICKHOUSE_USERNAME = process.env.CLICKHOUSE_USERNAME || 'default';
export const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
export const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'default';

export const NODE_URL =
    process.env.NODE_URL || 'https://tron-evm-rpc.publicnode.com';

/**
 * Network name extracted from CLICKHOUSE_DATABASE
 * The database format is expected to be "network:suffix"
 * Throws error if CLICKHOUSE_DATABASE is not set properly
 */
export const NETWORK = (() => {
    const network = CLICKHOUSE_DATABASE?.split(':')[0] || '';
    if (!network) {
        throw new Error(
            'CLICKHOUSE_DATABASE environment variable is not set properly.',
        );
    }
    return network;
})();
