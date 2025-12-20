import { describe, expect, test } from 'bun:test';
import {
    incrementError,
    incrementSuccess,
    startPrometheusServer,
    stopPrometheusServer,
} from './prometheus';

describe('Prometheus Server', () => {
    test('should start and stop server', async () => {
        const port = 19001;

        await startPrometheusServer(port);

        // Wait for server to start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify the Prometheus metrics endpoint is accessible
        const response = await fetch(`http://localhost:${port}/metrics`);
        expect(response.ok).toBe(true);

        const metricsText = await response.text();
        expect(metricsText.length).toBeGreaterThan(0);

        // Stop server
        await stopPrometheusServer();

        // Wait for server to close
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify server is closed
        try {
            await fetch(`http://localhost:${port}/metrics`);
            throw new Error('Server should be closed but is still accessible');
        } catch (err) {
            // Expected to fail after stop
            if (
                err instanceof Error &&
                err.message.includes('should be closed')
            ) {
                throw err;
            }
            // Otherwise it's the expected fetch error
            expect(true).toBe(true);
        }
    });

    test('should expose key metrics', async () => {
        const port = 19002;

        await startPrometheusServer(port);

        // Wait for server to start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Fetch metrics
        const response = await fetch(`http://localhost:${port}/metrics`);
        expect(response.ok).toBe(true);

        const metricsText = await response.text();

        // Verify key metrics are present
        expect(metricsText).toContain('scraper_completed_tasks_total');
        expect(metricsText).toContain('scraper_error_tasks_total');
        expect(metricsText).toContain('scraper_config_info');

        // Verify config info has labels
        expect(metricsText).toContain('clickhouse_url');
        expect(metricsText).toContain('clickhouse_database');
        expect(metricsText).toContain('node_url');

        await stopPrometheusServer();
    });

    test('should update metrics correctly', async () => {
        const port = 19003;
        const serviceName = 'Test Service';

        await startPrometheusServer(port);

        // Wait for server to start
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Set metrics
        incrementSuccess(serviceName);
        incrementError(serviceName);

        // Fetch metrics
        const response = await fetch(`http://localhost:${port}/metrics`);
        const metricsText = await response.text();

        // Verify metrics are updated (checking for service label)
        expect(metricsText).toContain(serviceName);

        await stopPrometheusServer();
    });

    test('should handle starting server on already used port', async () => {
        const port = 19004;

        await startPrometheusServer(port);

        // Try to start again on same port
        await startPrometheusServer(port); // Should log warning but not throw

        // Server should still be accessible
        const response = await fetch(`http://localhost:${port}/metrics`);
        expect(response.ok).toBe(true);

        await stopPrometheusServer();
    });
});
