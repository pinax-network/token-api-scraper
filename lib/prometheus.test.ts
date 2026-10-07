import { describe, expect, setSystemTime, test } from 'bun:test';
import { sleep } from 'bun';
import {
    incrementError,
    incrementSuccess,
    markActive,
    markIdle,
    setLivenessSource,
    startPrometheusServer,
    stopPrometheusServer,
    trackClickHouseOperation,
    trackRpcRequest,
} from './prometheus';

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

describe('Liveness endpoint', () => {
    test('returns 200 when last flush is fresh', async () => {
        const port = 19100;
        setLivenessSource(() => Date.now() - 1000); // 1s ago → well under 5min threshold
        await startPrometheusServer(port);
        await sleep(50);

        const res = await fetch(`http://localhost:${port}/live`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.healthy).toBe(true);
        expect(body.lastFlushAgeMs).toBeGreaterThan(0);

        await stopPrometheusServer();
        setLivenessSource(() => undefined);
        await sleep(50);
    });

    test('returns 503 when last flush is older than the stale threshold', async () => {
        const port = 19101;
        // Pretend last flush was 1 hour ago; default threshold is 5min
        setLivenessSource(() => Date.now() - 60 * 60 * 1000);
        await startPrometheusServer(port);
        await sleep(50);

        const res = await fetch(`http://localhost:${port}/live`);
        expect(res.status).toBe(503);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.healthy).toBe(false);

        await stopPrometheusServer();
        setLivenessSource(() => undefined);
        await sleep(50);
    });

    test('returns 200 during startup grace before any flush has run', async () => {
        const port = 19102;
        setLivenessSource(() => undefined); // no flush yet
        await startPrometheusServer(port);
        await sleep(50);

        const res = await fetch(`http://localhost:${port}/live`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.healthy).toBe(true);
        expect(body.withinStartupGrace).toBe(true);
        expect(body.lastFlushAgeMs).toBeUndefined();

        await stopPrometheusServer();
        await sleep(50);
    });

    test('returns 200 while the runner is idle between cycles, even if stale', async () => {
        const port = 19103;
        setLivenessSource(() => Date.now() - 60 * 60 * 1000);
        markIdle();
        await startPrometheusServer(port);
        await sleep(50);

        const res = await fetch(`http://localhost:${port}/live`);
        expect(res.status).toBe(200);
        expect(((await res.json()) as Record<string, unknown>).idle).toBe(true);

        markActive();
        const after = await fetch(`http://localhost:${port}/live`);
        expect(after.status).toBe(503);

        await stopPrometheusServer();
        setLivenessSource(() => undefined);
        await sleep(50);
    });

    test('excludes idle time between cycles from staleness', async () => {
        const port = 19104;
        await startPrometheusServer(port);
        await sleep(50);

        const minute = 60 * 1000;
        const t0 = Date.now();
        try {
            // Flush at t0, sleep between cycles t0+1m..t0+11m
            setLivenessSource(() => t0);
            setSystemTime(new Date(t0 + minute));
            markIdle();

            // Mid-sleep diagnostics include the in-progress span
            setSystemTime(new Date(t0 + 6 * minute));
            const mid = await fetch(`http://localhost:${port}/live`);
            const midBody = (await mid.json()) as Record<string, unknown>;
            expect(mid.status).toBe(200);
            expect(midBody.idle).toBe(true);
            expect(midBody.idleMsSinceFlush).toBe(5 * minute);

            setSystemTime(new Date(t0 + 11 * minute));
            markActive();

            // t0+12m: 12m wall-clock, but only 2m active → fresh
            setSystemTime(new Date(t0 + 12 * minute));
            let res = await fetch(`http://localhost:${port}/live`);
            let body = (await res.json()) as Record<string, unknown>;
            expect(res.status).toBe(200);
            expect(body.idleMsSinceFlush).toBe(10 * minute);

            // t0+20m: 10m active without a flush → stale
            setSystemTime(new Date(t0 + 20 * minute));
            res = await fetch(`http://localhost:${port}/live`);
            body = (await res.json()) as Record<string, unknown>;
            expect(res.status).toBe(503);
        } finally {
            setSystemTime();
            await stopPrometheusServer();
            setLivenessSource(() => undefined);
            await sleep(50);
        }
    });
});
