import { createLogger } from './logger';

/**
 * Tracks processing statistics (success and error counts) for a service.
 * Provides methods for incrementing counters and logging completion summaries.
 */
export class ProcessingStats {
    private successCount = 0;
    private errorCount = 0;
    private readonly log: ReturnType<typeof createLogger>;

    constructor(readonly serviceName: string) {
        this.log = createLogger(serviceName);
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
     * Log a completion summary with success, error, and total counts
     */
    logCompletion(): void {
        this.log.info('Service completed', {
            successCount: this.successCount,
            errorCount: this.errorCount,
            totalProcessed: this.successCount + this.errorCount,
        });
    }
}
