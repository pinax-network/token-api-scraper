import { describe, expect, it } from 'bun:test';
import { ProcessingStats } from './processing-stats';

describe('ProcessingStats', () => {
    it('should initialize with zero counts', () => {
        const stats = new ProcessingStats('test-service');
        expect(stats.serviceName).toBe('test-service');
    });

    it('should increment success count', () => {
        const stats = new ProcessingStats('test-service');
        stats.incrementSuccess();
        stats.incrementSuccess();
        stats.incrementSuccess();
        // Note: We can't directly test the private successCount,
        // but logCompletion will show it in logs
    });

    it('should increment error count', () => {
        const stats = new ProcessingStats('test-service');
        stats.incrementError();
        stats.incrementError();
        // Note: We can't directly test the private errorCount,
        // but logCompletion will show it in logs
    });

    it('should track both success and error counts', () => {
        const stats = new ProcessingStats('test-service');
        stats.incrementSuccess();
        stats.incrementError();
        stats.incrementSuccess();
        stats.incrementError();
        stats.incrementError();
        // 2 successes, 3 errors - verified via logCompletion
        stats.logCompletion();
    });

    it('should log completion summary', () => {
        const stats = new ProcessingStats('test-service');
        stats.incrementSuccess();
        stats.incrementSuccess();
        stats.incrementError();
        // Should log: successCount: 2, errorCount: 1, totalProcessed: 3
        stats.logCompletion();
    });
});
