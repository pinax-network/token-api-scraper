import { describe, expect, test } from 'bun:test';
import {
    incrementError,
    incrementSuccess,
    startPrometheusServer,
    stopPrometheusServer,
    trackClickHouseOperation,
    trackRpcRequest,
} from './prometheus';
import { sleep } from 'bun';

describe('Prometheus Server', () => {
    test('should start and stop server', async () => {
        const port = 19001;

        await startPrometheusServer(port);

        await sleep(100);

        // Verify the Prometheus metrics endpoint is accessible
        const response = await fetch(`http://localhost:${port}/metrics`);
        expect(response.ok).toBe(true);

        const metricsText = await response.text();
        expect(metricsText.length).toBeGreaterThan(0);

        // Stop server
        await stopPrometheusServer();

        // Wait for server to close
        await sleep(100);

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

        await sleep(100);

        // Fetch metrics
        const response = await fetch(`http://localhost:${port}/metrics`);
        expect(response.ok).toBe(true);

        const metricsText = await response.text();

        // Verify key metrics are present
        expect(metricsText).toContain('scraper_completed_tasks_total');
        expect(metricsText).toContain('scraper_error_tasks_total');
        expect(metricsText).toContain('scraper_config_info');

        // Verify config info has labels
        expect(metricsText).toContain('clickhouse_host');
        expect(metricsText).toContain('clickhouse_database');
        expect(metricsText).toContain('node_host');

        await stopPrometheusServer();
    });

    test('should update metrics correctly', async () => {
        const port = 19003;
        const serviceName = 'Test Service';

        await startPrometheusServer(port);

        await sleep(100);

        // Set metrics
        incrementSuccess(serviceName);
        incrementError(serviceName);

        // Fetch metrics
        const response = await fetch(`http://localhost:${port}/metrics`);
        const metricsText = await response.text();

        // Verify metrics are updated (checking for service label)
        expect(metricsText).toContain(serviceName);

        await stopPrometheusServer();

        // Wait for server to fully close
        await sleep(100);
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

        // Wait for server to fully close
        await sleep(100);
    });

    test('should reject when port is already used by external process', async () => {
        const port = 19005;

        // Start an external HTTP server on the port
        const externalServer = Bun.serve({
            port,
            fetch() {
                return new Response('External server');
            },
        });

        try {
            // Trying to start Prometheus on same port should reject
            await expect(startPrometheusServer(port)).rejects.toThrow();
        } finally {
            // Cleanup external server
            externalServer.stop();
        }
    });
});

describe('Prometheus Histogram Helpers', () => {
    test('should track ClickHouse operations with correct labels', async () => {
        const port = 19006;

        await startPrometheusServer(port);

        await sleep(100);

        // Track some ClickHouse operations
        const startTime = performance.now();
        trackClickHouseOperation('read', 'success', startTime);
        trackClickHouseOperation('write', 'success', startTime);
        trackClickHouseOperation('read', 'error', startTime);

        // Fetch metrics
        const response = await fetch(`http://localhost:${port}/metrics`);
        const metricsText = await response.text();

        // Verify histogram metric is present with correct name
        expect(metricsText).toContain('scraper_clickhouse_operations_seconds');

        // Verify labels are present
        expect(metricsText).toContain('operation_type="read"');
        expect(metricsText).toContain('operation_type="write"');
        expect(metricsText).toContain('status="success"');
        expect(metricsText).toContain('status="error"');

        await stopPrometheusServer();

        // Wait for server to fully close
        await sleep(100);
    });

    test('should track RPC requests with correct labels', async () => {
        const port = 19007;

        await startPrometheusServer(port);

        await sleep(100);

        // Track some RPC requests
        const startTime = performance.now();
        trackRpcRequest('eth_call', 'success', startTime);
        trackRpcRequest('eth_getBalance', 'success', startTime);
        trackRpcRequest('eth_call', 'error', startTime);

        // Fetch metrics
        const response = await fetch(`http://localhost:${port}/metrics`);
        const metricsText = await response.text();

        // Verify histogram metric is present with correct name
        expect(metricsText).toContain('scraper_rpc_requests_seconds');

        // Verify labels are present
        expect(metricsText).toContain('method="eth_call"');
        expect(metricsText).toContain('method="eth_getBalance"');
        expect(metricsText).toContain('status="success"');
        expect(metricsText).toContain('status="error"');

        await stopPrometheusServer();

        // Wait for server to fully close
        await sleep(100);
    });
});
