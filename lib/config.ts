/**
 * Central configuration file for environment variables
 * This module handles parsing and validation of environment variables used across all services
 */

/**
 * Number of concurrent RPC requests
 * Default: 10
 */
export const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10', 10);

/**
 * Enable Prometheus metrics endpoint
 * Default: false
 */
export const ENABLE_PROMETHEUS = process.env.ENABLE_PROMETHEUS === 'true';

/**
 * HTTP port for Prometheus metrics endpoint
 * Default: 9090
 */
export const PROMETHEUS_PORT = parseInt(process.env.PROMETHEUS_PORT || '9090', 10);

/**
 * Enable batch insert mechanism for ClickHouse inserts
 * When enabled, inserts are queued and flushed periodically or when reaching max size
 * Default: false (disabled for backward compatibility)
 */
export const BATCH_INSERT_ENABLED = process.env.BATCH_INSERT_ENABLED === 'true';

/**
 * Interval in milliseconds to flush batch inserts
 * Default: 1000ms (1 second)
 */
export const BATCH_INSERT_INTERVAL_MS = parseInt(process.env.BATCH_INSERT_INTERVAL_MS || '1000', 10);

/**
 * Maximum number of rows in a batch before forcing a flush
 * Default: 10000
 */
export const BATCH_INSERT_MAX_SIZE = parseInt(process.env.BATCH_INSERT_MAX_SIZE || '10000', 10);

/**
 * Enable RPC batch requests
 * Default: false (for backward compatibility)
 */
export const RPC_BATCH_ENABLED = process.env.RPC_BATCH_ENABLED === 'true';

/**
 * Maximum number of requests per RPC batch
 * Default: 10
 */
export const RPC_BATCH_SIZE = parseInt(process.env.RPC_BATCH_SIZE || '10', 10);
