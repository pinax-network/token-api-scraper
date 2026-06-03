import { describe, expect, test } from 'bun:test';
import { padIsoToMicroseconds } from './live';

describe('padIsoToMicroseconds', () => {
    test('pads ms-precision ISO to 6 fractional digits', () => {
        const ms = Date.parse('2026-06-01T16:10:42.233Z');
        expect(padIsoToMicroseconds(ms)).toBe('2026-06-01T16:10:42.233000Z');
    });

    test('lex-compares correctly against Kalshi µs-precision timestamps', () => {
        // Pre-fix bug: `.233Z` lex-orders AFTER `.233435Z` because `'4' < 'Z'`.
        // After padding, the same-ms bucket compares as we expect.
        const ms = Date.parse('2026-06-01T16:10:42.233Z');
        const watermark = padIsoToMicroseconds(ms);
        expect('2026-06-01T16:10:42.233435Z' > watermark).toBe(true);
        expect('2026-06-01T16:10:42.000000Z' < watermark).toBe(true);
    });
});
