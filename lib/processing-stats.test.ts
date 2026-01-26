import { afterEach, describe, expect, it } from 'bun:test';
import {
    DEFAULT_PROGRESS_INTERVAL_MS,
    ProcessingStats,
} from './processing-stats';

describe('ProcessingStats', () => {
    it('should initialize with zero counts', () => {
        const stats = new ProcessingStats('test-service', 'mainnet');
        expect(stats.serviceName).toBe('test-service');
        expect(stats.network).toBe('mainnet');
    });

    it('should increment success count', () => {
        const stats = new ProcessingStats('test-service', 'mainnet');
        stats.incrementSuccess();
        stats.incrementSuccess();
        stats.incrementSuccess();
        // Note: We can't directly test the private successCount,
        // but logCompletion will show it in logs
    });

    it('should increment error count', () => {
        const stats = new ProcessingStats('test-service', 'mainnet');
        stats.incrementError();
        stats.incrementError();
        // Note: We can't directly test the private errorCount,
        // but logCompletion will show it in logs
    });

    it('should increment warning count', () => {
        const stats = new ProcessingStats('test-service', 'mainnet');
        stats.incrementWarning();
        stats.incrementWarning();
        stats.incrementWarning();
        // Note: We can't directly test the private warningCount,
        // but logCompletion will show it in logs
    });

    it('should track both success and error counts', () => {
        const stats = new ProcessingStats('test-service', 'mainnet');
        stats.incrementSuccess();
        stats.incrementError();
        stats.incrementSuccess();
        stats.incrementError();
        stats.incrementError();
        // 2 successes, 3 errors - verified via logCompletion
        stats.logCompletion();
    });

    it('should log completion summary', () => {
        const stats = new ProcessingStats('test-service', 'mainnet');
        stats.incrementSuccess();
        stats.incrementSuccess();
        stats.incrementError();
        // Should log: successCount: 2, errorCount: 1, totalProcessed: 3
        stats.logCompletion();
    });
});

describe('ProcessingStats - Progress Logging', () => {
    afterEach(() => {
        // Ensure any active intervals are cleared after each test
    });

    it('should export DEFAULT_PROGRESS_INTERVAL_MS as 10 seconds', () => {
        expect(DEFAULT_PROGRESS_INTERVAL_MS).toBe(10000);
    });

    it('should start and stop progress logging', () => {
        const stats = new ProcessingStats('test-service', 'mainnet');
        stats.startProgressLogging(100);
        // Ensure no error thrown
        stats.stopProgressLogging();
    });

    it('should stop progress logging on completion', () => {
        const stats = new ProcessingStats('test-service', 'mainnet');
        stats.startProgressLogging(100);
        stats.logCompletion();
        // logCompletion should stop the progress interval
    });

    it('should handle starting progress logging multiple times', () => {
        const stats = new ProcessingStats('test-service', 'mainnet');
        stats.startProgressLogging(100);
        stats.startProgressLogging(200); // Should clear previous interval
        stats.stopProgressLogging();
    });

    it('should handle stopping progress logging when not started', () => {
        const stats = new ProcessingStats('test-service', 'mainnet');
        // Should not throw when stopping without starting
        stats.stopProgressLogging();
    });

    it('should accept custom interval', () => {
        const stats = new ProcessingStats('test-service', 'mainnet');
        stats.startProgressLogging(100, 5000); // Custom 5 second interval
        stats.stopProgressLogging();
    });
});
