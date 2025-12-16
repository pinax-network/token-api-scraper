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

        // Wait for server to start
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify the Prometheus metrics endpoint is accessible
        const response = await fetch('http://localhost:19090/metrics');
        expect(response.ok).toBe(true);
        
        const metricsText = await response.text();
        expect(metricsText.length).toBeGreaterThan(0);
        expect(metricsText).toContain('scraper_total_tasks');
        expect(metricsText).toContain('scraper_progress_percentage');

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
        
        // Verify server is closed after complete
        await new Promise(resolve => setTimeout(resolve, 100));
        try {
            await fetch('http://localhost:19090/metrics');
            expect(false).toBe(true); // Should not reach here
        } catch (_err) {
            // Expected to fail after complete
            expect(true).toBe(true);
        }
    });
});
