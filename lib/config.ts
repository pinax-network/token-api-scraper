/**
 * Central configuration file for environment variables
 * This module handles parsing and validation of environment variables used across all services
 */

// ============================================================================
// Default Configuration Constants
// ============================================================================

/**
 * Default values for all configuration options
 * These are used as fallbacks when environment variables are not set
 */
export const DEFAULT_CONFIG = {
    // ClickHouse Database
    CLICKHOUSE_URL: 'http://localhost:8123',
    CLICKHOUSE_USERNAME: 'default',
    CLICKHOUSE_PASSWORD: '',
    // CLICKHOUSE_DATABASE has no default to prevent accidental loading into wrong DB

    // RPC Node
    NODE_URL: 'https://tron-evm-rpc.publicnode.com',
    CONCURRENCY: 40,

    // RPC Retry Configuration
    MAX_RETRIES: 3,
    BASE_DELAY_MS: 400,
    JITTER_MIN: 0.7,
    JITTER_MAX: 1.3,
    MAX_DELAY_MS: 30000,
    TIMEOUT_MS: 10000,

    // Prometheus Monitoring
    PROMETHEUS_PORT: 9090,
    PROMETHEUS_HOSTNAME: '0.0.0.0',

    // Batch Insert
    BATCH_INSERT_INTERVAL_MS: 1000,
    BATCH_INSERT_MAX_SIZE: 10000,

    // Auto-restart
    AUTO_RESTART_DELAY: 10,

    // Prune errors (1 week = 604800 seconds)
    ALLOW_PRUNE_ERRORS: 604800,
} as const;

// ============================================================================
// Configuration Variables
// ============================================================================

/**
 * Enable verbose logging output
 * Default: false
 */
export const VERBOSE = process.env.VERBOSE === 'true';

/**
 * Logging level
 * Default: 'info'
 */
export const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

/**
 * Number of concurrent RPC requests
 * Default: 40
 */
export const CONCURRENCY = parseInt(
    process.env.CONCURRENCY || String(DEFAULT_CONFIG.CONCURRENCY),
    10,
);

/**
 * HTTP port for Prometheus metrics endpoint
 * Prometheus is always enabled
 * Default: 9090
 */
export const PROMETHEUS_PORT = parseInt(
    process.env.PROMETHEUS_PORT || String(DEFAULT_CONFIG.PROMETHEUS_PORT),
    10,
);

/**
 * Hostname for Prometheus server to bind to
 * Default: '0.0.0.0' (all interfaces)
 */
export const PROMETHEUS_HOSTNAME =
    process.env.PROMETHEUS_HOSTNAME || DEFAULT_CONFIG.PROMETHEUS_HOSTNAME;

/**
 * Interval in milliseconds to flush batch inserts
 * Default: 1000ms (1 second)
 */
export const BATCH_INSERT_INTERVAL_MS = parseInt(
    process.env.BATCH_INSERT_INTERVAL_MS ||
        String(DEFAULT_CONFIG.BATCH_INSERT_INTERVAL_MS),
    10,
);

/**
 * Maximum number of rows in a batch before forcing a flush
 * Default: 10000
 */
export const BATCH_INSERT_MAX_SIZE = parseInt(
    process.env.BATCH_INSERT_MAX_SIZE ||
        String(DEFAULT_CONFIG.BATCH_INSERT_MAX_SIZE),
    10,
);

export const CLICKHOUSE_URL =
    process.env.CLICKHOUSE_URL || DEFAULT_CONFIG.CLICKHOUSE_URL;
export const CLICKHOUSE_USERNAME =
    process.env.CLICKHOUSE_USERNAME || DEFAULT_CONFIG.CLICKHOUSE_USERNAME;
export const CLICKHOUSE_PASSWORD =
    process.env.CLICKHOUSE_PASSWORD || DEFAULT_CONFIG.CLICKHOUSE_PASSWORD;
export const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE;

export const NODE_URL = process.env.NODE_URL || DEFAULT_CONFIG.NODE_URL;

/**
 * Network name extracted from CLICKHOUSE_DATABASE
 * The database format is expected to be "network:suffix"
 * Returns empty string if CLICKHOUSE_DATABASE is not set properly
 * Services that require NETWORK should validate it before use
 */
export const NETWORK = CLICKHOUSE_DATABASE?.split(':')[0] || '';

/**
 * Get the network name with validation
 * Throws error if CLICKHOUSE_DATABASE is not set properly
 */
export function getNetwork(): string {
    if (!NETWORK) {
        throw new Error(
            'CLICKHOUSE_DATABASE environment variable is not set properly.',
        );
    }
    return NETWORK;
}
