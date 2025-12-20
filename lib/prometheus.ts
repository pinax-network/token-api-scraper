import * as http from 'http';
import * as promClient from 'prom-client';
import { CLICKHOUSE_DATABASE, CLICKHOUSE_URL, NODE_URL } from './config';
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
