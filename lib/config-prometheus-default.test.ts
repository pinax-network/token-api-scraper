import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

/**
 * Tests for ENABLE_PROMETHEUS default behavior
 *
 * This test suite verifies that ENABLE_PROMETHEUS defaults to true
 * and can be explicitly disabled by setting the environment variable to 'false'
 */
describe('ENABLE_PROMETHEUS default behavior', () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
        // Save the original environment variable
        originalEnv = process.env.ENABLE_PROMETHEUS;
    });

    afterEach(() => {
        // Restore the original environment variable
        if (originalEnv !== undefined) {
            process.env.ENABLE_PROMETHEUS = originalEnv;
        } else {
            delete process.env.ENABLE_PROMETHEUS;
        }

        // Clear the module cache to reload config with new env
        delete require.cache[require.resolve('./config')];
    });

    test('should default to true when ENABLE_PROMETHEUS is not set', () => {
        delete process.env.ENABLE_PROMETHEUS;

        // Re-import config after clearing env
        const { ENABLE_PROMETHEUS } = require('./config');

        expect(ENABLE_PROMETHEUS).toBe(true);
    });

    test('should be true when ENABLE_PROMETHEUS is set to "true"', () => {
        process.env.ENABLE_PROMETHEUS = 'true';

        // Re-import config after setting env
        delete require.cache[require.resolve('./config')];
        const { ENABLE_PROMETHEUS } = require('./config');

        expect(ENABLE_PROMETHEUS).toBe(true);
    });

    test('should be false when ENABLE_PROMETHEUS is set to "false"', () => {
        process.env.ENABLE_PROMETHEUS = 'false';

        // Re-import config after setting env
        delete require.cache[require.resolve('./config')];
        const { ENABLE_PROMETHEUS } = require('./config');

        expect(ENABLE_PROMETHEUS).toBe(false);
    });

    test('should default to true when ENABLE_PROMETHEUS is empty string', () => {
        process.env.ENABLE_PROMETHEUS = '';

        // Re-import config after setting env
        delete require.cache[require.resolve('./config')];
        const { ENABLE_PROMETHEUS } = require('./config');

        expect(ENABLE_PROMETHEUS).toBe(true);
    });

    test('should default to true when ENABLE_PROMETHEUS is set to any value other than "false"', () => {
        process.env.ENABLE_PROMETHEUS = '1';

        // Re-import config after setting env
        delete require.cache[require.resolve('./config')];
        const { ENABLE_PROMETHEUS } = require('./config');

        expect(ENABLE_PROMETHEUS).toBe(true);
    });
});
