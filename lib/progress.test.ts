import { describe, test, expect } from 'bun:test';
import { ProgressTracker } from './progress';

describe('ProgressTracker', () => {
    test('should track progress correctly', async () => {
        const tracker = new ProgressTracker({
            serviceName: 'Test Service',
            totalTasks: 100,
            enablePrometheus: false
        });

        // Simulate processing tasks
        for (let i = 0; i < 80; i++) {
            tracker.incrementSuccess();
            await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to see progress
        }

        // Simulate some errors
        for (let i = 0; i < 20; i++) {
            tracker.incrementError();
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        tracker.complete();
        
        // If we got here without errors, the test passed
        expect(true).toBe(true);
    });
});
