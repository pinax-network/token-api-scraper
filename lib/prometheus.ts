import * as http from 'http';
import * as promClient from 'prom-client';
import {
    CLICKHOUSE_DATABASE,
    CLICKHOUSE_URL,
    NODE_URL,
    PROMETHEUS_HOSTNAME,
} from './config';
import { createLogger } from './logger';

/** How long since the last successful batch flush before `/live` returns 503.
 * A liveness probe targets the scraper worker actually making progress, not
 * just the process being up. Default 5min covers normal cycle pacing. */
const LIVENESS_STALE_THRESHOLD_MS = parseInt(
    process.env.LIVENESS_STALE_THRESHOLD_MS || '300000',
    10,
);
const STARTUP_GRACE_MS = parseInt(
    process.env.LIVENESS_STARTUP_GRACE_MS || '600000',
    10,
);
const startedAt = Date.now();

/** Setter-injected so this module doesn't import batch-insert directly, which
 * would close a dependency cycle (batch-insert uses `trackClickHouseOperation`
 * from this module). */
let getLastFlushAt: () => number | undefined = () => undefined;

export function setLivenessSource(fn: () => number | undefined): void {
    getLastFlushAt = fn;
}

const log = createLogger('prometheus');

// Prometheus metrics
const register = new promClient.Registry();

// Add default metrics (CPU, memory, etc.)
promClient.collectDefaultMetrics({ register });

// Custom metrics
const completedTasksCounter = new promClient.Counter({
    name: 'scraper_completed_tasks_total',
    help: 'Total number of completed tasks',
    labelNames: ['service', 'status'],
    registers: [register],
});

const errorTasksCounter = new promClient.Counter({
    name: 'scraper_error_tasks_total',
    help: 'Total number of failed tasks',
    labelNames: ['service'],
    registers: [register],
});

// ClickHouse operation metrics
const clickhouseOperations = new promClient.Histogram({
    name: 'scraper_clickhouse_operations_seconds',
    help: 'Duration of ClickHouse operations in seconds',
    labelNames: ['operation_type', 'status'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    registers: [register],
});

// RPC request metrics
const rpcRequests = new promClient.Histogram({
    name: 'scraper_rpc_requests_seconds',
    help: 'Duration of RPC requests in seconds',
    labelNames: ['method', 'status'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    registers: [register],
});

// Per-scope freshness — analogue to substreams-sink-sql `head_block_number`.
// Unix seconds (float) of the newest record this scope has processed. Grafana
// computes drift as `time() - scraper_head_time_seconds`, matching the
// `head_block_time_drift` panels on the public stats dashboard.
const headTimeGauge = new promClient.Gauge({
    name: 'scraper_head_time_seconds',
    help: 'Unix timestamp (seconds) of the most recent record processed by this scope',
    labelNames: ['service', 'scope'],
    registers: [register],
});

// Backfill scope reached `__DRAINED__` — analogue to
// `substreams_sink_backprocessing_completion`. Reset to 0 when the scope
// resumes (operator cleared the row or the next cycle re-engaged).
const backfillDrainedGauge = new promClient.Gauge({
    name: 'scraper_backfill_drained',
    help: 'Set to 1 when a backfill scope has fully drained its source',
    labelNames: ['service', 'scope'],
    registers: [register],
});

// Scope was quarantined due to a cursor loop (`__POISONED__`). No substreams
// analogue — but the state is operationally important: cycle won't advance
// until the row is cleared manually.
const poisonedGauge = new promClient.Gauge({
    name: 'scraper_poisoned',
    help: 'Set to 1 when a scope has been quarantined due to a cursor loop',
    labelNames: ['service', 'scope'],
    registers: [register],
});

// Rows successfully written to ClickHouse — analogue to
// `substreams_sink_postgres_flushed_rows_count`.
const rowsInsertedCounter = new promClient.Counter({
    name: 'scraper_rows_inserted_total',
    help: 'Total rows successfully inserted into ClickHouse, by destination table',
    labelNames: ['service', 'table'],
    registers: [register],
});

// Pages received from the upstream API — analogue to
// `substreams_sink_data_message`. Granularity is page (one HTTP response),
// not item.
const pagesReceivedCounter = new promClient.Counter({
    name: 'scraper_pages_received_total',
    help: 'Total upstream pages received, by scope',
    labelNames: ['service', 'scope'],
    registers: [register],
});

// Items dropped before queue.add() — typically Kalshi `0001-01-01` sentinels
// that would null-out into non-nullable CH columns. Surfaces silent skips.
const itemsSkippedCounter = new promClient.Counter({
    name: 'scraper_items_skipped_total',
    help: 'Total upstream items skipped before insert, by destination table and reason',
    labelNames: ['service', 'table', 'reason'],
    registers: [register],
});

// Upstream HTTP errors — more granular than the existing
// `scraper_error_tasks_total{service}` so dashboards can drill into which
// endpoint or status code is failing.
const httpErrorsCounter = new promClient.Counter({
    name: 'scraper_http_errors_total',
    help: 'Upstream HTTP errors, by endpoint and status code',
    labelNames: ['service', 'endpoint', 'status_code'],
    registers: [register],
});

// Wallclock per full `run()` invocation, labelled by outcome so a slow-cycle
// alert can distinguish "still finishing healthy" from "throwing late".
const cycleDurationHistogram = new promClient.Histogram({
    name: 'scraper_cycle_duration_seconds',
    help: 'Duration of one complete service cycle in seconds',
    labelNames: ['service', 'outcome'],
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300, 600],
    registers: [register],
});

// Cached at `initService` so metric helpers below don't need the service name
// threaded through every call site. Falls back to `'unknown'` if a helper
// fires before init (e.g. in a test that imports a module directly).
let serviceNameLabel = 'unknown';

export function setServiceNameLabel(name: string): void {
    serviceNameLabel = name;
}

// Configuration info metrics
const configInfoGauge = new promClient.Gauge({
    name: 'scraper_config_info',
    help: 'Configuration information for the scraper',
    labelNames: ['clickhouse_host', 'clickhouse_database', 'node_host'],
    registers: [register],
});

// Track whether config metrics have been initialized
let configMetricsInitialized = false;
let prometheusServer: http.Server | undefined;

/**
 * Sanitize a URL to extract only the hostname, removing credentials, port, and path
 * @param url - The URL to sanitize
 * @returns The sanitized hostname or 'not_set' if invalid
 */
function sanitizeUrl(url: string | undefined): string {
    if (!url || url === 'not_set') {
        return 'not_set';
    }
    try {
        const parsed = new URL(url);
        return parsed.hostname;
    } catch {
        return 'redacted';
    }
}

/**
 * Initialize Prometheus server
 * @param port - Port to listen on
 * @param hostname - Hostname to bind to
 * @returns Promise that resolves when server is started
 */
export function startPrometheusServer(
    port: number,
    hostname = PROMETHEUS_HOSTNAME,
): Promise<void> {
    return new Promise((resolve, reject) => {
        // Set configuration info metrics once (only on first initialization)
        if (!configMetricsInitialized) {
            // Read from process.env at runtime to get CLI overrides
            const clickhouseUrl = process.env.CLICKHOUSE_URL || CLICKHOUSE_URL;
            const clickhouseDatabase =
                process.env.CLICKHOUSE_DATABASE || CLICKHOUSE_DATABASE;
            const nodeUrl = process.env.NODE_URL || NODE_URL;

            configInfoGauge
                .labels(
                    sanitizeUrl(clickhouseUrl),
                    clickhouseDatabase || 'not_set',
                    sanitizeUrl(nodeUrl),
                )
                .set(1);
            configMetricsInitialized = true;
        }

        if (prometheusServer) {
            log.warn('Prometheus server already running', { port });
            resolve();
            return;
        }

        prometheusServer = http.createServer(async (req, res) => {
            if (req.url === '/metrics' || req.url === '/') {
                res.setHeader('Content-Type', register.contentType);
                const metrics = await register.metrics();
                res.end(metrics);
            } else if (req.url === '/live') {
                handleLiveness(res);
            } else {
                res.statusCode = 404;
                res.end('Not Found');
            }
        });

        prometheusServer.listen(port, hostname, () => {
            log.info('Prometheus server started', {
                port,
                url: `http://${hostname}:${port}/metrics`,
            });
            resolve();
        });

        prometheusServer.on('error', (err) => {
            log.error('Prometheus server error', { error: err.message });
            prometheusServer = undefined;
            reject(err);
        });
    });
}

/**
 * Liveness probe: healthy if a batch flush succeeded within the stale
 * threshold, or we're still within the startup grace window.
 */
function handleLiveness(res: http.ServerResponse): void {
    res.setHeader('Content-Type', 'application/json');
    const lastFlushAt = getLastFlushAt();
    const now = Date.now();
    const withinGrace = now - startedAt < STARTUP_GRACE_MS;
    const ageMs = lastFlushAt !== undefined ? now - lastFlushAt : undefined;
    const healthy =
        (ageMs !== undefined && ageMs < LIVENESS_STALE_THRESHOLD_MS) ||
        (lastFlushAt === undefined && withinGrace);
    res.statusCode = healthy ? 200 : 503;
    res.end(
        JSON.stringify({
            healthy,
            lastFlushAgeMs: ageMs,
            staleThresholdMs: LIVENESS_STALE_THRESHOLD_MS,
            withinStartupGrace: withinGrace && lastFlushAt === undefined,
        }),
    );
}

/**
 * Stop the Prometheus server
 */
export function stopPrometheusServer(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!prometheusServer) {
            resolve();
            return;
        }

        prometheusServer.close((err) => {
            if (err) {
                log.error('Failed to close Prometheus server', {
                    error: err.message,
                });
                reject(err);
            } else {
                prometheusServer = undefined;
                log.info('Prometheus server stopped');
                resolve();
            }
        });
    });
}

/**
 * Increment success counter for a service
 */
export function incrementSuccess(serviceName: string): void {
    completedTasksCounter.labels(serviceName, 'success').inc();
}

/**
 * Increment error counter for a service
 */
export function incrementError(serviceName: string): void {
    completedTasksCounter.labels(serviceName, 'error').inc();
    errorTasksCounter.labels(serviceName).inc();
}

/**
 * Track a ClickHouse operation
 * @param operationType - Type of operation ('read' or 'write')
 * @param status - Operation status ('success' or 'error')
 * @param startTime - Start time in milliseconds (from performance.now())
 */
export function trackClickHouseOperation(
    operationType: 'read' | 'write',
    status: 'success' | 'error',
    startTime: number,
): void {
    const durationSeconds = (performance.now() - startTime) / 1000;
    clickhouseOperations.labels(operationType, status).observe(durationSeconds);
}

/**
 * Track an RPC request
 * @param method - RPC method name (e.g., 'eth_getBlockByNumber')
 * @param status - Request status ('success' or 'error')
 * @param startTime - Start time in milliseconds (from performance.now())
 */
export function trackRpcRequest(
    method: string,
    status: 'success' | 'error',
    startTime: number,
): void {
    const durationSeconds = (performance.now() - startTime) / 1000;
    rpcRequests.labels(method, status).observe(durationSeconds);
}

/** Record the newest record-timestamp this scope has processed. Accepts ISO
 * 8601 (with or without fractional seconds) or unix-ms; converts to unix
 * seconds with sub-second precision preserved when present. */
export function setScopeHeadTime(
    scope: string,
    timestamp: string | number,
): void {
    const seconds =
        typeof timestamp === 'number'
            ? timestamp / 1000
            : new Date(timestamp).getTime() / 1000;
    if (!Number.isFinite(seconds)) return;
    headTimeGauge.labels(serviceNameLabel, scope).set(seconds);
}

/** Mark a backfill scope as drained (1) or resumed (0). */
export function setBackfillDrained(scope: string, drained: boolean): void {
    backfillDrainedGauge.labels(serviceNameLabel, scope).set(drained ? 1 : 0);
}

/** Mark a scope as quarantined (1) or healthy (0). */
export function setScopePoisoned(scope: string, poisoned: boolean): void {
    poisonedGauge.labels(serviceNameLabel, scope).set(poisoned ? 1 : 0);
}

export function incrementRowsInserted(table: string, count: number): void {
    if (count > 0)
        rowsInsertedCounter.labels(serviceNameLabel, table).inc(count);
}

export function incrementPagesReceived(scope: string): void {
    pagesReceivedCounter.labels(serviceNameLabel, scope).inc();
}

export function incrementItemsSkipped(table: string, reason: string): void {
    itemsSkippedCounter.labels(serviceNameLabel, table, reason).inc();
}

export function incrementHttpErrors(
    endpoint: string,
    statusCode: number | string,
): void {
    httpErrorsCounter
        .labels(serviceNameLabel, endpoint, String(statusCode))
        .inc();
}

export function observeCycleDuration(
    seconds: number,
    outcome: 'success' | 'error',
): void {
    cycleDurationHistogram.labels(serviceNameLabel, outcome).observe(seconds);
}
