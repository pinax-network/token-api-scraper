/**
 * Service initialization utilities
 * Handles common initialization tasks for all services
 */

import { initBatchInsertQueue } from './batch-insert';
import {
    BATCH_INSERT_INTERVAL_MS,
    BATCH_INSERT_MAX_SIZE,
    CONCURRENCY,
    PROMETHEUS_PORT,
    VERBOSE,
} from './config';

export interface ServiceInitOptions {
    serviceName: string;
}

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

    if (VERBOSE) {
        console.log(
            `⚡ Batch insert enabled: flush every ${BATCH_INSERT_INTERVAL_MS}ms or ${BATCH_INSERT_MAX_SIZE} rows`,
        );
        console.log(
            `🚀 Starting ${options.serviceName} with concurrency: ${CONCURRENCY}`,
        );
        console.log(
            `📊 Prometheus metrics enabled on port ${PROMETHEUS_PORT}`,
        );
    }
}
