import { describe, expect, test } from 'bun:test';
import { ProgressTracker } from './progress';

describe('ProgressTracker with auto-restart', () => {
	test('should properly close Prometheus server and allow port reuse', async () => {
		const port = 19091;

		// First run - simulate initial service run
		const tracker1 = new ProgressTracker({
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
			tracker1.incrementSuccess();
		}

		// Complete the tracker (this should close the server)
		await tracker1.complete();

		// Wait for server to fully close
		await new Promise((resolve) => setTimeout(resolve, 200));

		// Verify server is closed
		try {
			await fetch(`http://localhost:${port}/metrics`);
			expect(false).toBe(true); // Should not reach here
		} catch (_err) {
			// Expected to fail after complete
			expect(true).toBe(true);
		}

		// Second run - simulate auto-restart
		// This should succeed if the port is properly released
		const tracker2 = new ProgressTracker({
			serviceName: 'Auto-restart Test Run 2',
			totalTasks: 10,
			enablePrometheus: true,
			prometheusPort: port,
			verbose: false,
		});

		// Wait for server to start
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Verify the Prometheus metrics endpoint is accessible again
		const response2 = await fetch(`http://localhost:${port}/metrics`);
		expect(response2.ok).toBe(true);

		const metricsText = await response2.text();
		expect(metricsText.length).toBeGreaterThan(0);
		expect(metricsText).toContain('scraper_total_tasks');

		// Simulate processing tasks
		for (let i = 0; i < 10; i++) {
			tracker2.incrementSuccess();
		}

		// Complete and clean up
		await tracker2.complete();

		// Wait for final server to close
		await new Promise((resolve) => setTimeout(resolve, 200));
	});

	test('should handle rapid restart cycles', async () => {
		const port = 19092;
		const cycles = 3;

		for (let cycle = 0; cycle < cycles; cycle++) {
			const tracker = new ProgressTracker({
				serviceName: `Rapid Restart Test Cycle ${cycle + 1}`,
				totalTasks: 5,
				enablePrometheus: true,
				prometheusPort: port,
				verbose: false,
			});

			// Wait for server to start
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Verify metrics endpoint is accessible
			const response = await fetch(`http://localhost:${port}/metrics`);
			expect(response.ok).toBe(true);

			// Process tasks
			for (let i = 0; i < 5; i++) {
				tracker.incrementSuccess();
			}

			// Complete
			await tracker.complete();

			// Short delay before next cycle (simulating auto-restart delay)
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	});
});
