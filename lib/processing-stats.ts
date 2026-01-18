import type { Logger } from 'tslog';
import { createLogger } from './logger';

/**
 * Class for tracking success and error counts during service processing.
 * Provides thread-safe counters and standardized completion logging.
 */
export class ProcessingStats {
    private _successCount = 0;
    private _errorCount = 0;
    private readonly log: Logger<unknown>;

    constructor(serviceName: string) {
        this.log = createLogger(serviceName);
    }

    /** Increment success counter */
    incrementSuccess(): void {
        this._successCount++;
    }

    /** Increment error counter */
    incrementError(): void {
        this._errorCount++;
    }

    /** Get current success count */
    get successCount(): number {
        return this._successCount;
    }

    /** Get current error count */
    get errorCount(): number {
        return this._errorCount;
    }

    /** Get total processed count */
    get totalProcessed(): number {
        return this._successCount + this._errorCount;
    }

    /** Log service completion summary at info level */
    logCompletion(): void {
        this.log.info('Service completed', {
            successCount: this._successCount,
            errorCount: this._errorCount,
            totalProcessed: this.totalProcessed,
        });
    }
}
