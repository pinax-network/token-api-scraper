import { describe, test, expect } from 'bun:test';
import { CONCURRENCY, ENABLE_PROMETHEUS, PROMETHEUS_PORT } from './config';

describe('config module', () => {
    test('CONCURRENCY should be a valid number', () => {
        expect(typeof CONCURRENCY).toBe('number');
        expect(isNaN(CONCURRENCY)).toBe(false);
    });

    test('CONCURRENCY should be at least 1', () => {
        expect(CONCURRENCY).toBeGreaterThanOrEqual(1);
    });

    test('ENABLE_PROMETHEUS should be a boolean', () => {
        expect(typeof ENABLE_PROMETHEUS).toBe('boolean');
    });

    test('PROMETHEUS_PORT should be a valid number', () => {
        expect(typeof PROMETHEUS_PORT).toBe('number');
        expect(isNaN(PROMETHEUS_PORT)).toBe(false);
    });

    test('PROMETHEUS_PORT should be a valid port number', () => {
        expect(PROMETHEUS_PORT).toBeGreaterThanOrEqual(1);
        expect(PROMETHEUS_PORT).toBeLessThanOrEqual(65535);
    });
});
