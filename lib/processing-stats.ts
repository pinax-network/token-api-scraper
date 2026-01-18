import { createLogger } from './logger';

/**
 * Default interval for progress logging in milliseconds (10 seconds)
 */
export const DEFAULT_PROGRESS_INTERVAL_MS = 10000;

/**
 * Tracks processing statistics (success and error counts) for a service.
 * Provides methods for incrementing counters and logging completion summaries.
 * Supports periodic progress logging at configurable intervals.
 */
export class ProcessingStats {
    private successCount = 0;
    private errorCount = 0;
    private totalItems = 0;
    private readonly log: ReturnType<typeof createLogger>;
    private readonly startTime: number;
    private progressInterval: ReturnType<typeof setInterval> | null = null;

    constructor(readonly serviceName: string) {
        this.log = createLogger(serviceName);
        this.startTime = performance.now();
    }

    /**
     * Increment the success counter
     */
    incrementSuccess(): void {
        this.successCount++;
    }

    /**
     * Increment the error counter
     */
    incrementError(): void {
        this.errorCount++;
    }

    /**
     * Start periodic progress logging
     * @param totalItems - Total number of items to process (for percentage calculation)
     * @param intervalMs - Interval in milliseconds between progress logs (default: 10 seconds)
     */
    startProgressLogging(
        totalItems: number,
        intervalMs: number = DEFAULT_PROGRESS_INTERVAL_MS,
    ): void {
        this.totalItems = totalItems;

        // Clear any existing interval
        this.stopProgressLogging();

        this.progressInterval = setInterval(() => {
            this.logProgress();
        }, intervalMs);
    }

    /**
     * Stop periodic progress logging
     */
    stopProgressLogging(): void {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }

    /**
     * Log current progress with processed count and percentage
     */
    private logProgress(): void {
        const processed = this.successCount + this.errorCount;
        const elapsedSecs = (performance.now() - this.startTime) / 1000;
        const percentComplete =
            this.totalItems > 0
                ? Math.round((processed / this.totalItems) * 100)
                : 0;
        const itemsPerSec =
            elapsedSecs > 0 ? Math.round(processed / elapsedSecs) : 0;

        this.log.info('Processing progress', {
            serviceName: this.serviceName,
            processed,
            total: this.totalItems,
            percentComplete,
            successCount: this.successCount,
            errorCount: this.errorCount,
            elapsedSecs: Math.round(elapsedSecs),
            itemsPerSec,
        });
    }

    /**
     * Log a completion summary with success, error, and total counts
     * Also stops progress logging if active
     */
    logCompletion(): void {
        // Stop progress logging when completed
        this.stopProgressLogging();

        const processingTimeSecs = (performance.now() - this.startTime) / 1000;
        this.log.info('Service completed', {
            serviceName: this.serviceName,
            successCount: this.successCount,
            errorCount: this.errorCount,
            totalProcessed: this.successCount + this.errorCount,
            processingTimeSecs,
        });
    }
}
