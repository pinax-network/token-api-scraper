import cliProgress from 'cli-progress';
import * as promClient from 'prom-client';
import * as http from 'http';

// Prometheus metrics
const register = new promClient.Registry();

// Add default metrics (CPU, memory, etc.)
promClient.collectDefaultMetrics({ register });

// Custom metrics
const totalTasksGauge = new promClient.Gauge({
    name: 'scraper_total_tasks',
    help: 'Total number of tasks to process',
    labelNames: ['service'],
    registers: [register]
});

const completedTasksCounter = new promClient.Counter({
    name: 'scraper_completed_tasks_total',
    help: 'Total number of completed tasks',
    labelNames: ['service', 'status'],
    registers: [register]
});

const errorTasksCounter = new promClient.Counter({
    name: 'scraper_error_tasks_total',
    help: 'Total number of failed tasks',
    labelNames: ['service'],
    registers: [register]
});

const requestRateGauge = new promClient.Gauge({
    name: 'scraper_requests_per_second',
    help: 'Current requests per second',
    labelNames: ['service'],
    registers: [register]
});

const progressGauge = new promClient.Gauge({
    name: 'scraper_progress_percentage',
    help: 'Current progress percentage',
    labelNames: ['service'],
    registers: [register]
});

export interface ProgressTrackerOptions {
    serviceName: string;
    totalTasks: number;
    enablePrometheus?: boolean;
    prometheusPort?: number;
}

export class ProgressTracker {
    private serviceName: string;
    private totalTasks: number;
    private completedTasks: number = 0;
    private successfulTasks: number = 0;
    private errorTasks: number = 0;
    private startTime: number;
    private progressBar: cliProgress.SingleBar;
    private prometheusServer?: http.Server;
    // Track completed tasks with timestamps for normalized rate calculation
    private taskTimestamps: number[] = [];
    private readonly RATE_WINDOW_MS = 60000; // 1 minute window for rate calculation

    constructor(options: ProgressTrackerOptions) {
        this.serviceName = options.serviceName;
        this.totalTasks = options.totalTasks;
        this.startTime = Date.now();

        // Initialize progress bar
        this.progressBar = new cliProgress.SingleBar({
            format: `${this.serviceName} |{bar}| {percentage}% | ETA: {custom_eta} | {value}/{total} | Rate: {rate} req/s | Elapsed: {elapsed}`,
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
        });

        this.progressBar.start(this.totalTasks, 0, {
            rate: '0.00',
            elapsed: '0s',
            custom_eta: '0s'
        });

        // Initialize Prometheus metrics
        totalTasksGauge.labels(this.serviceName).set(this.totalTasks);
        progressGauge.labels(this.serviceName).set(0);

        // Start Prometheus server if enabled
        if (options.enablePrometheus) {
            this.startPrometheusServer(options.prometheusPort || 9090);
        }
    }

    private startPrometheusServer(port: number) {
        this.prometheusServer = http.createServer(async (req, res) => {
            if (req.url === '/metrics') {
                res.setHeader('Content-Type', register.contentType);
                const metrics = await register.metrics();
                res.end(metrics);
            } else {
                res.statusCode = 404;
                res.end('Not Found');
            }
        });

        this.prometheusServer.listen(port, () => {
            console.log(`📊 Prometheus metrics available at http://localhost:${port}/metrics`);
        });
    }

    public incrementSuccess() {
        this.completedTasks++;
        this.successfulTasks++;
        this.updateProgress();
        
        // Update Prometheus metrics
        completedTasksCounter.labels(this.serviceName, 'success').inc();
    }

    public incrementError() {
        this.completedTasks++;
        this.errorTasks++;
        this.updateProgress();
        
        // Update Prometheus metrics
        completedTasksCounter.labels(this.serviceName, 'error').inc();
        errorTasksCounter.labels(this.serviceName).inc();
    }

    private updateProgress() {
        const now = Date.now();
        const elapsed = (now - this.startTime) / 1000; // seconds
        
        // Add current timestamp to the buffer
        this.taskTimestamps.push(now);
        
        // Remove timestamps older than the rate window (1 minute)
        // Use a more efficient approach: find the first valid index and slice once
        const cutoffTime = now - this.RATE_WINDOW_MS;
        let firstValidIndex = 0;
        while (firstValidIndex < this.taskTimestamps.length && 
               this.taskTimestamps[firstValidIndex] < cutoffTime) {
            firstValidIndex++;
        }
        if (firstValidIndex > 0) {
            this.taskTimestamps = this.taskTimestamps.slice(firstValidIndex);
        }
        
        // Calculate rate based on tasks completed within the window
        let rate: number;
        if (this.taskTimestamps.length > 1) {
            // Use the time span of tasks within the window
            const windowStartTime = this.taskTimestamps[0];
            const windowElapsedMs = now - windowStartTime;
            
            if (windowElapsedMs > 0) {
                // Rate is tasks in window divided by time span in seconds
                rate = (this.taskTimestamps.length / windowElapsedMs) * 1000;
            } else {
                // Fallback to instantaneous calculation
                rate = 0;
            }
        } else {
            // Not enough data for window calculation, use total elapsed time
            rate = elapsed > 0 ? this.completedTasks / elapsed : 0;
        }
        
        const percentage = (this.completedTasks / this.totalTasks) * 100;
        
        // Calculate custom ETA based on our smoothed rate
        // ETA = (Total - Completed) / Rate per second
        const remainingTasks = this.totalTasks - this.completedTasks;
        let customEta: string;
        if (rate > 0 && remainingTasks > 0) {
            const etaSeconds = remainingTasks / rate;
            customEta = this.formatElapsed(etaSeconds);
        } else {
            customEta = remainingTasks > 0 ? '∞' : '0s';
        }

        this.progressBar.update(this.completedTasks, {
            rate: rate.toFixed(2),
            elapsed: this.formatElapsed(elapsed),
            custom_eta: customEta
        });

        // Update Prometheus metrics
        requestRateGauge.labels(this.serviceName).set(rate);
        progressGauge.labels(this.serviceName).set(percentage);
    }

    private formatElapsed(seconds: number): string {
        if (seconds < 60) {
            return `${seconds.toFixed(0)}s`;
        } else if (seconds < 3600) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}m ${secs}s`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${mins}m`;
        }
    }

    public complete() {
        this.progressBar.stop();
        const elapsed = (Date.now() - this.startTime) / 1000;
        // Use average rate over entire duration for final statistics
        const rate = elapsed > 0 ? this.completedTasks / elapsed : 0;
        const successRate = this.totalTasks > 0 ? (this.successfulTasks / this.totalTasks) * 100 : 0;

        console.log(`\n✨ ${this.serviceName} completed!`);
        console.log(`📊 Statistics:`);
        console.log(`   Total tasks: ${this.totalTasks}`);
        console.log(`   Successful: ${this.successfulTasks} (${successRate.toFixed(1)}%)`);
        console.log(`   Failed: ${this.errorTasks}`);
        console.log(`   Time elapsed: ${this.formatElapsed(elapsed)}`);
        console.log(`   Average rate: ${rate.toFixed(2)} req/s`);
        
        if (this.prometheusServer) {
            console.log(`\n📊 Prometheus metrics still available at the metrics endpoint`);
            console.log(`   Press Ctrl+C to stop the Prometheus server`);
        }
    }

    public stop() {
        this.progressBar.stop();
        if (this.prometheusServer) {
            this.prometheusServer.close();
        }
    }
}
