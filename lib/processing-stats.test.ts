import { describe, expect, test } from 'bun:test';
import { ProcessingStats } from './processing-stats';

describe('ProcessingStats', () => {
    test('should initialize with zero counts', () => {
        const stats = new ProcessingStats('test-service');
        expect(stats.successCount).toBe(0);
        expect(stats.errorCount).toBe(0);
        expect(stats.totalProcessed).toBe(0);
    });

    test('should increment success count', () => {
        const stats = new ProcessingStats('test-service');
        stats.incrementSuccess();
        expect(stats.successCount).toBe(1);
        expect(stats.errorCount).toBe(0);
        expect(stats.totalProcessed).toBe(1);
    });

    test('should increment error count', () => {
        const stats = new ProcessingStats('test-service');
        stats.incrementError();
        expect(stats.successCount).toBe(0);
        expect(stats.errorCount).toBe(1);
        expect(stats.totalProcessed).toBe(1);
    });

    test('should track multiple increments', () => {
        const stats = new ProcessingStats('test-service');
        stats.incrementSuccess();
        stats.incrementSuccess();
        stats.incrementError();
        expect(stats.successCount).toBe(2);
        expect(stats.errorCount).toBe(1);
        expect(stats.totalProcessed).toBe(3);
    });

    test('should log completion summary without throwing', () => {
        const stats = new ProcessingStats('test-service');
        stats.incrementSuccess();
        stats.incrementSuccess();
        stats.incrementError();
        // Just verify it doesn't throw
        expect(() => stats.logCompletion()).not.toThrow();
    });
});
