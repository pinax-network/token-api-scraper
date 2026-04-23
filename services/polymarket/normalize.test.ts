import { describe, expect, test } from 'bun:test';
import { normalizeGammaTimestamp } from './index';

// Isolated from services/polymarket/index.test.ts so the mock.module setup
// there doesn't race with these pure-function tests under concurrent
// bun test load.
describe('normalizeGammaTimestamp', () => {
    test('strips microsecond precision and trailing Z', () => {
        expect(normalizeGammaTimestamp('2026-04-22T23:20:10.368406Z')).toBe(
            '2026-04-22T23:20:10',
        );
    });

    test('strips fractional seconds and numeric offsets', () => {
        expect(normalizeGammaTimestamp('2026-04-22T23:20:10.5+00:00')).toBe(
            '2026-04-22T23:20:10',
        );
        expect(normalizeGammaTimestamp('2026-04-22T23:20:10.123-05:00')).toBe(
            '2026-04-22T23:20:10',
        );
    });

    test('strips a bare Z suffix even without fractional seconds', () => {
        expect(normalizeGammaTimestamp('2026-04-22T23:20:10Z')).toBe(
            '2026-04-22T23:20:10',
        );
    });

    test('passes chain-sourced space-separated timestamps through unchanged', () => {
        expect(normalizeGammaTimestamp('2026-04-22 14:54:44')).toBe(
            '2026-04-22 14:54:44',
        );
    });

    test('returns epoch sentinel for empty or missing input', () => {
        expect(normalizeGammaTimestamp('')).toBe('1970-01-01T00:00:00');
        expect(normalizeGammaTimestamp(undefined)).toBe('1970-01-01T00:00:00');
        expect(normalizeGammaTimestamp(null)).toBe('1970-01-01T00:00:00');
    });
});
