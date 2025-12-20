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
    LOG_LEVEL,
    NODE_URL,
    PROMETHEUS_HOSTNAME,
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
            config: {
                LOG_LEVEL,
                CLICKHOUSE_URL,
                CLICKHOUSE_DATABASE,
                NODE_URL,
                CONCURRENCY,
                PROMETHEUS_PORT,
                PROMETHEUS_HOSTNAME,
                BATCH_INSERT_INTERVAL_MS,
                BATCH_INSERT_MAX_SIZE,
            },
        });
        serviceInitialized = true;
    } else {
        log.debug('Service restarting: ', options.serviceName);
    }
}
