/**
 * Service initialization utilities
 * Handles common initialization tasks for all services
 */

import { getBatchInsertQueue, initBatchInsertQueue } from './batch-insert';
import {
    BATCH_INSERT_INTERVAL_MS,
    BATCH_INSERT_MAX_SIZE,
    CONCURRENCY,
    DEFAULT_CONFIG,
} from './config';
import { createLogger } from './logger';
import { setLivenessSource } from './prometheus';

const log = createLogger('service');

// Track whether service has been initialized (for one-time logs)
let serviceInitialized = false;

/** Wall-clock heartbeat for services that legitimately have nothing to flush
 * in a cycle (no new trades, no refresh due, drained backfill archives).
 * The liveness probe ORs this with the batch queue's `lastSuccessfulFlushAt`
 * so idle cycles don't trip the probe — but services must NOT bump this on
 * cycles that errored, so silent insert failures still surface. */
let lastServiceHeartbeat: number | undefined;

export function markServiceAlive(): void {
    lastServiceHeartbeat = Date.now();
}

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

    // Wire the liveness probe's progress signal without letting prometheus.ts
    // depend on batch-insert.ts (batch-insert already depends on prometheus
    // for metrics, so a direct import would close the cycle). Returns the
    // most recent of the batch-queue flush stamp and the service heartbeat —
    // services that do real writes report progress via the queue; idle
    // services report via `markServiceAlive`.
    setLivenessSource(() => {
        let queueAt: number | undefined;
        try {
            queueAt = getBatchInsertQueue().getLastSuccessfulFlushAt();
        } catch {
            queueAt = undefined;
        }
        if (queueAt === undefined) return lastServiceHeartbeat;
        if (lastServiceHeartbeat === undefined) return queueAt;
        return Math.max(queueAt, lastServiceHeartbeat);
    });

    // Log startup info (always at INFO level)
    // Read env vars at runtime to capture CLI overrides
    if (!serviceInitialized) {
        log.info('Service starting', {
            service: options.serviceName,
            config: {
                LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
                CLICKHOUSE_URL:
                    process.env.CLICKHOUSE_URL ?? DEFAULT_CONFIG.CLICKHOUSE_URL,
                CLICKHOUSE_DATABASE: process.env.CLICKHOUSE_DATABASE,
                CLICKHOUSE_DATABASE_INSERT:
                    process.env.CLICKHOUSE_DATABASE_INSERT ??
                    process.env.CLICKHOUSE_DATABASE,
                NODE_URL: process.env.NODE_URL,
                CONCURRENCY,
                PROMETHEUS_PORT:
                    process.env.PROMETHEUS_PORT ??
                    DEFAULT_CONFIG.PROMETHEUS_PORT,
                PROMETHEUS_HOSTNAME:
                    process.env.PROMETHEUS_HOSTNAME ??
                    DEFAULT_CONFIG.PROMETHEUS_HOSTNAME,
                BATCH_INSERT_INTERVAL_MS,
                BATCH_INSERT_MAX_SIZE,
            },
        });
        serviceInitialized = true;
    } else {
        log.debug('Service restarting: ', options.serviceName);
    }
}
