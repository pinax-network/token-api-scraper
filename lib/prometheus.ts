import * as http from 'http';
import * as promClient from 'prom-client';
import {
    CLICKHOUSE_DATABASE,
    CLICKHOUSE_URL,
    NODE_URL,
    VERBOSE,
} from './config';
import { createLogger } from './logger';

const log = createLogger('prometheus');

// Prometheus metrics
const register = new promClient.Registry();

// Add default metrics (CPU, memory, etc.)
promClient.collectDefaultMetrics({ register });

// Custom metrics
const totalTasksGauge = new promClient.Gauge({
    name: 'scraper_total_tasks',
    help: 'Total number of tasks to process',
    labelNames: ['service'],
    registers: [register],
});

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

const requestRateGauge = new promClient.Gauge({
    name: 'scraper_requests_per_second',
    help: 'Current requests per second',
    labelNames: ['service'],
    registers: [register],
});

const progressGauge = new promClient.Gauge({
    name: 'scraper_progress_percentage',
    help: 'Current progress percentage',
    labelNames: ['service'],
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
 * @returns Promise that resolves when server is started
 */
export function startPrometheusServer(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        // Set configuration info metrics once (only on first initialization)
        if (!configMetricsInitialized) {
            configInfoGauge
                .labels(CLICKHOUSE_URL, CLICKHOUSE_DATABASE, NODE_URL)
                .set(1);
            configMetricsInitialized = true;
        }

        if (prometheusServer) {
            log.warn('Prometheus server already running', { port });
            resolve();
            return;
        }

        prometheusServer = http.createServer(async (req, res) => {
            if (req.url === '/metrics') {
                res.setHeader('Content-Type', register.contentType);
                const metrics = await register.metrics();
                res.end(metrics);
            } else {
                res.statusCode = 404;
                res.end('Not Found');
            }
        });

        prometheusServer.listen(port, '0.0.0.0', () => {
            if (VERBOSE) {
                console.log(
                    `📊 Prometheus metrics server listening on http://0.0.0.0:${port}`,
                );
            }
            log.info('Prometheus server started', { port });
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
 * Update Prometheus metrics for a service
 */
export interface MetricsUpdate {
    serviceName: string;
    totalTasks?: number;
    completedTasks?: number;
    successfulTasks?: number;
    errorTasks?: number;
    requestRate?: number;
    progressPercentage?: number;
}

export function updateMetrics(update: MetricsUpdate): void {
    const { serviceName } = update;

    if (update.totalTasks !== undefined) {
        totalTasksGauge.labels(serviceName).set(update.totalTasks);
    }

    if (update.completedTasks !== undefined && update.successfulTasks !== undefined) {
        // Increment counters by the change since last update
        // For simplicity, we'll just increment by 1 for each call
        completedTasksCounter.labels(serviceName, 'success').inc();
    }

    if (update.errorTasks !== undefined) {
        completedTasksCounter.labels(serviceName, 'error').inc();
        errorTasksCounter.labels(serviceName).inc();
    }

    if (update.requestRate !== undefined) {
        requestRateGauge.labels(serviceName).set(update.requestRate);
    }

    if (update.progressPercentage !== undefined) {
        progressGauge.labels(serviceName).set(update.progressPercentage);
    }
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
 * Set total tasks for a service
 */
export function setTotalTasks(serviceName: string, total: number): void {
    totalTasksGauge.labels(serviceName).set(total);
}

/**
 * Set progress percentage for a service
 */
export function setProgress(serviceName: string, percentage: number): void {
    progressGauge.labels(serviceName).set(percentage);
}

/**
 * Set request rate for a service
 */
export function setRequestRate(serviceName: string, rate: number): void {
    requestRateGauge.labels(serviceName).set(rate);
}

/**
 * Reset metrics for a service (useful for restart)
 */
export function resetMetrics(serviceName: string, totalTasks: number): void {
    totalTasksGauge.labels(serviceName).set(totalTasks);
    progressGauge.labels(serviceName).set(0);
}
