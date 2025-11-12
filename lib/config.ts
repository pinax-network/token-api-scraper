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
 * Name of the transfers table to query
 * Default: "transfers"
 * Options: "transfers", "native_transfer", "trc20_transfer"
 */
export const TRANSFERS_TABLE = process.env.TRANSFERS_TABLE || 'transfers';
