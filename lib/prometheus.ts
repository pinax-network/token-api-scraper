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
    name: 'scraper_clickhouse_operations',
    help: 'Duration of ClickHouse operations in seconds',
    labelNames: ['operation_type', 'status'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    registers: [register],
});

// RPC request metrics
const rpcRequests = new promClient.Histogram({
    name: 'scraper_rpc_requests',
    help: 'Duration of RPC requests in seconds',
    labelNames: ['method', 'status'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    registers: [register],
});

// Configuration info metrics
const configInfoGauge = new promClient.Gauge({
    name: 'scraper_config_info',
    help: 'Configuration information for the scraper',
    labelNames: ['clickhouse_url', 'clickhouse_database', 'node_url'],
    registers: [register],
});

// Track whether config metrics have been initialized
let configMetricsInitialized = false;
let prometheusServer: http.Server | undefined;

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
            configInfoGauge
                .labels(
                    CLICKHOUSE_URL,
                    CLICKHOUSE_DATABASE || 'not_set',
                    NODE_URL || 'not_set',
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
 * @param durationSeconds - Duration of the operation in seconds
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
 * @param durationSeconds - Duration of the request in seconds
 */
export function trackRpcRequest(
    method: string,
    status: 'success' | 'error',
    startTime: number,
): void {
    const durationSeconds = (performance.now() - startTime) / 1000;
    rpcRequests.labels(method, status).observe(durationSeconds);
}
