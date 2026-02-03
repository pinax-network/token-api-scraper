import * as http from 'http';
import * as promClient from 'prom-client';
import {
    CLICKHOUSE_DATABASE,
    CLICKHOUSE_URL,
    NODE_URL,
    PROMETHEUS_HOSTNAME,
} from './config';
import { createLogger } from './logger';

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
