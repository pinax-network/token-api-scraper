/**
 * Service initialization utilities
 * Handles common initialization tasks for all services
 */

import { CONCURRENCY, ENABLE_PROMETHEUS, PROMETHEUS_PORT, BATCH_INSERT_INTERVAL_MS, BATCH_INSERT_MAX_SIZE } from './config';
import { initBatchInsertQueue } from './batch-insert';

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
    console.log(`⚡ Batch insert enabled: flush every ${BATCH_INSERT_INTERVAL_MS}ms or ${BATCH_INSERT_MAX_SIZE} rows`);

    console.log(`🚀 Starting ${options.serviceName} with concurrency: ${CONCURRENCY}`);
    if (ENABLE_PROMETHEUS) {
        console.log(`📊 Prometheus metrics enabled on port ${PROMETHEUS_PORT}`);
    }
}
