import { describe, expect, test } from 'bun:test';
import { ProgressTracker } from './progress';

describe('ProgressTracker with auto-restart', () => {
    test('should keep Prometheus server alive when requested', async () => {
        const port = 19091;

        // First run - simulate initial service run
        const tracker = new ProgressTracker({
            serviceName: 'Auto-restart Test Run 1',
            totalTasks: 10,
            enablePrometheus: true,
            prometheusPort: port,
            verbose: false,
        });

        // Wait for server to start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify the Prometheus metrics endpoint is accessible
        const response1 = await fetch(`http://localhost:${port}/metrics`);
        expect(response1.ok).toBe(true);

        // Simulate processing tasks
        for (let i = 0; i < 10; i++) {
            tracker.incrementSuccess();
        }

        // Complete the tracker with keepPrometheusAlive flag
        await tracker.complete({ keepPrometheusAlive: true });

        // Wait a bit
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify server is still accessible
        const response2 = await fetch(`http://localhost:${port}/metrics`);
        expect(response2.ok).toBe(true);

        // Reset for second run
        tracker.reset(10);

        // Verify the Prometheus metrics endpoint is still accessible
        const response3 = await fetch(`http://localhost:${port}/metrics`);
        expect(response3.ok).toBe(true);

        const metricsText = await response3.text();
        expect(metricsText.length).toBeGreaterThan(0);
        expect(metricsText).toContain('scraper_total_tasks');

        // Simulate processing tasks
        for (let i = 0; i < 10; i++) {
            tracker.incrementSuccess();
        }

        // Complete without keeping alive to clean up
        await tracker.complete({ keepPrometheusAlive: false });

        // Wait for server to close
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Verify server is closed
        try {
            await fetch(`http://localhost:${port}/metrics`);
            throw new Error('Server should be closed but is still accessible');
        } catch (err) {
            // Expected to fail after complete - fetch should throw
            if (
                err instanceof Error &&
                err.message.includes('should be closed')
            ) {
                throw err; // Re-throw if it's our error
            }
            // Otherwise it's the expected fetch error
            expect(true).toBe(true);
        }
    });

    test('should handle rapid restart cycles with reset', async () => {
        const port = 19092;
        const cycles = 3;

        const tracker = new ProgressTracker({
            serviceName: `Rapid Restart Test`,
            totalTasks: 5,
            enablePrometheus: true,
            prometheusPort: port,
            verbose: false,
        });

        // Wait for server to start
        await new Promise((resolve) => setTimeout(resolve, 50));

        for (let cycle = 0; cycle < cycles; cycle++) {
            if (cycle > 0) {
                // Reset tracker for next cycle
                tracker.reset(5);
            }

            // Verify metrics endpoint is accessible
            const response = await fetch(`http://localhost:${port}/metrics`);
            expect(response.ok).toBe(true);

            // Process tasks
            for (let i = 0; i < 5; i++) {
                tracker.incrementSuccess();
            }

            // Complete but keep Prometheus alive (except on last cycle)
            const keepAlive = cycle < cycles - 1;
            await tracker.complete({ keepPrometheusAlive: keepAlive });

            // Short delay before next cycle (simulating auto-restart delay)
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Wait for server to close after final cycle
        await new Promise((resolve) => setTimeout(resolve, 200));
    });
});
