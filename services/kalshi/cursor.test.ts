import { describe, expect, test } from 'bun:test';
import { isDue } from './cursor';

describe('isDue', () => {
    test('returns true when no prior run exists (lastMs undefined)', () => {
        expect(isDue(undefined, 60)).toBe(true);
    });

    test('returns true when interval has elapsed', () => {
        const tenMinAgo = Date.now() - 10 * 60 * 1000;
        expect(isDue(tenMinAgo, 60)).toBe(true);
    });

    test('returns false when interval has not elapsed', () => {
        const justNow = Date.now() - 1000;
        expect(isDue(justNow, 60)).toBe(false);
    });

    test('returns true at exact interval boundary', () => {
        const exactlyAtInterval = Date.now() - 60 * 1000;
        // >= comparison: equal-or-greater is due.
        expect(isDue(exactlyAtInterval, 60)).toBe(true);
    });
});
