import { describe, expect, test } from 'bun:test';
import {
    BATCH_INSERT_INTERVAL_MS,
    BATCH_INSERT_MAX_SIZE,
    CONCURRENCY,
    ENABLE_PROMETHEUS,
    NETWORK,
    PROMETHEUS_PORT,
    RPC_BATCH_ENABLED,
    RPC_BATCH_SIZE,
} from './config';

describe('config module', () => {
    test('CONCURRENCY should be a valid number', () => {
        expect(typeof CONCURRENCY).toBe('number');
        expect(Number.isNaN(CONCURRENCY)).toBe(false);
    });

    test('CONCURRENCY should be at least 1', () => {
        expect(CONCURRENCY).toBeGreaterThanOrEqual(1);
    });

    test('ENABLE_PROMETHEUS should be a boolean', () => {
        expect(typeof ENABLE_PROMETHEUS).toBe('boolean');
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

    test('RPC_BATCH_ENABLED should be a boolean', () => {
        expect(typeof RPC_BATCH_ENABLED).toBe('boolean');
    });

    test('RPC_BATCH_SIZE should be a valid number', () => {
        expect(typeof RPC_BATCH_SIZE).toBe('number');
        expect(Number.isNaN(RPC_BATCH_SIZE)).toBe(false);
    });

    test('RPC_BATCH_SIZE should be positive', () => {
        expect(RPC_BATCH_SIZE).toBeGreaterThan(0);
    });

    test('NETWORK should be a non-empty string', () => {
        expect(typeof NETWORK).toBe('string');
        expect(NETWORK.length).toBeGreaterThan(0);
    });
});
