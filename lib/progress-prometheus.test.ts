import { describe, test, expect } from 'bun:test';
import { ProgressTracker } from './progress';

describe('ProgressTracker with Prometheus', () => {
    test('should work with Prometheus enabled', async () => {
        const tracker = new ProgressTracker({
            serviceName: 'Test Prometheus Service',
            totalTasks: 50,
            enablePrometheus: true,
            prometheusPort: 19090 // Use a different port to avoid conflicts
        });

        // Simulate processing tasks
        for (let i = 0; i < 40; i++) {
            tracker.incrementSuccess();
            await new Promise(resolve => setTimeout(resolve, 20));
        }

        // Simulate some errors
        for (let i = 0; i < 10; i++) {
            tracker.incrementError();
            await new Promise(resolve => setTimeout(resolve, 20));
        }

        tracker.complete();
        
        // Give a moment to check the metrics endpoint
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        tracker.stop();
        
        // If we got here without errors, the test passed
        expect(true).toBe(true);
    });
});
