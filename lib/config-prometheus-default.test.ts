import { describe, expect, test } from 'bun:test';

/**
 * Tests for ENABLE_PROMETHEUS default behavior
 *
 * This test suite verifies that ENABLE_PROMETHEUS is always true
 * (Prometheus is always enabled)
 */
describe('ENABLE_PROMETHEUS default behavior', () => {
    test('should always be true (Prometheus is always enabled)', () => {
        const { ENABLE_PROMETHEUS } = require('./config');

        expect(ENABLE_PROMETHEUS).toBe(true);
    });
});
