import { describe, expect, test } from 'bun:test';
import {
    BATCH_INSERT_INTERVAL_MS,
    BATCH_INSERT_MAX_SIZE,
    CLICKHOUSE_DATABASE_READ,
    CLICKHOUSE_DATABASE_WRITE,
    CONCURRENCY,
    DEFAULT_CONFIG,
    getNetwork,
    PROMETHEUS_PORT,
} from './config';

describe('config module', () => {
    test('CONCURRENCY should be a valid number', () => {
        expect(typeof CONCURRENCY).toBe('number');
        expect(Number.isNaN(CONCURRENCY)).toBe(false);
    });

    test('CONCURRENCY should be at least 1', () => {
        expect(CONCURRENCY).toBeGreaterThanOrEqual(1);
    });

    test('PROMETHEUS_PORT should be a valid number', () => {
        expect(typeof PROMETHEUS_PORT).toBe('number');
        expect(Number.isNaN(PROMETHEUS_PORT)).toBe(false);
    });

    test('PROMETHEUS_PORT should be a valid port number', () => {
        expect(PROMETHEUS_PORT).toBeGreaterThanOrEqual(1);
        expect(PROMETHEUS_PORT).toBeLessThanOrEqual(65535);
    });

    test('BATCH_INSERT_INTERVAL_MS should be a valid number', () => {
        expect(typeof BATCH_INSERT_INTERVAL_MS).toBe('number');
        expect(Number.isNaN(BATCH_INSERT_INTERVAL_MS)).toBe(false);
    });

    test('BATCH_INSERT_INTERVAL_MS should be positive', () => {
        expect(BATCH_INSERT_INTERVAL_MS).toBeGreaterThan(0);
    });

    test('BATCH_INSERT_MAX_SIZE should be a valid number', () => {
        expect(typeof BATCH_INSERT_MAX_SIZE).toBe('number');
        expect(Number.isNaN(BATCH_INSERT_MAX_SIZE)).toBe(false);
    });

    test('BATCH_INSERT_MAX_SIZE should be positive', () => {
        expect(BATCH_INSERT_MAX_SIZE).toBeGreaterThan(0);
    });

    test('getNetwork should return network from CLICKHOUSE_DATABASE', () => {
        // This test depends on whether CLICKHOUSE_DATABASE is set
        if (process.env.CLICKHOUSE_DATABASE) {
            expect(typeof getNetwork()).toBe('string');
            expect(getNetwork().length).toBeGreaterThan(0);
        } else {
            expect(() => getNetwork()).toThrow(
                'CLICKHOUSE_DATABASE environment variable is not set properly.',
            );
        }
    });
});

describe('DEFAULT_CONFIG', () => {
    test('AUTO_RESTART_DELAY should be a valid number', () => {
        expect(typeof DEFAULT_CONFIG.AUTO_RESTART_DELAY).toBe('number');
        expect(Number.isNaN(DEFAULT_CONFIG.AUTO_RESTART_DELAY)).toBe(false);
    });

    test('AUTO_RESTART_DELAY should be at least 1', () => {
        expect(DEFAULT_CONFIG.AUTO_RESTART_DELAY).toBeGreaterThanOrEqual(1);
    });
});

describe('CLICKHOUSE_DATABASE_READ and CLICKHOUSE_DATABASE_WRITE', () => {
    test('CLICKHOUSE_DATABASE_READ should fall back to CLICKHOUSE_DATABASE when not set', () => {
        // Both should be undefined when neither env var is set,
        // or CLICKHOUSE_DATABASE_READ equals CLICKHOUSE_DATABASE if only CLICKHOUSE_DATABASE is set
        if (!process.env.CLICKHOUSE_DATABASE_READ) {
            expect(CLICKHOUSE_DATABASE_READ).toBe(
                process.env.CLICKHOUSE_DATABASE,
            );
        }
    });

    test('CLICKHOUSE_DATABASE_WRITE should fall back to CLICKHOUSE_DATABASE when not set', () => {
        // Both should be undefined when neither env var is set,
        // or CLICKHOUSE_DATABASE_WRITE equals CLICKHOUSE_DATABASE if only CLICKHOUSE_DATABASE is set
        if (!process.env.CLICKHOUSE_DATABASE_WRITE) {
            expect(CLICKHOUSE_DATABASE_WRITE).toBe(
                process.env.CLICKHOUSE_DATABASE,
            );
        }
    });

    test('CLICKHOUSE_DATABASE_READ and CLICKHOUSE_DATABASE_WRITE should be exported', () => {
        // Just verify they are accessible (can be undefined if env vars not set)
        expect(
            CLICKHOUSE_DATABASE_READ === undefined ||
                typeof CLICKHOUSE_DATABASE_READ === 'string',
        ).toBe(true);
        expect(
            CLICKHOUSE_DATABASE_WRITE === undefined ||
                typeof CLICKHOUSE_DATABASE_WRITE === 'string',
        ).toBe(true);
    });
});
