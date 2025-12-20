/**
 * Service initialization utilities
 * Handles common initialization tasks for all services
 */

import { initBatchInsertQueue } from './batch-insert';
import {
    BATCH_INSERT_INTERVAL_MS,
    BATCH_INSERT_MAX_SIZE,
    CLICKHOUSE_DATABASE,
    CLICKHOUSE_URL,
    CONCURRENCY,
    NODE_URL,
    PROMETHEUS_PORT,
} from './config';
import { createLogger } from './logger';

const log = createLogger('service');

export interface ServiceInitOptions {
    serviceName: string;
}

// Track whether service has been initialized (for one-time logs)
let serviceInitialized = false;

/**
 * Initialize common service configuration
 * - Initializes batch insert queue
 * - Logs service startup information
 */
export function initService(options: ServiceInitOptions): void {
    // Initialize batch insert queue
    initBatchInsertQueue({
        intervalMs: BATCH_INSERT_INTERVAL_MS,
        maxSize: BATCH_INSERT_MAX_SIZE,
    });

    // Log startup info (always at INFO level)
    if (!serviceInitialized) {
        log.info('Service starting', {
            service: options.serviceName,
            logLevel: process.env.LOG_LEVEL ?? 'info',
            clickhouseUrl: CLICKHOUSE_URL,
            clickhouseDatabase: CLICKHOUSE_DATABASE,
            nodeUrl: NODE_URL,
            concurrency: CONCURRENCY,
            prometheusPort: PROMETHEUS_PORT,
            batchInsertIntervalMs: BATCH_INSERT_INTERVAL_MS,
            batchInsertMaxSize: BATCH_INSERT_MAX_SIZE,
        });
        serviceInitialized = true;
    } else {
        log.debug('Service restarting: ', options.serviceName);
    }
}
