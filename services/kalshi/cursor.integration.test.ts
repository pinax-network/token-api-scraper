// Integration tests for cursor checkpoint round-trip against a real CH.
// Gated by `KALSHI_API_TESTS=1` AND requires a running CH with the kalshi
// schema applied (see `npm run cli setup kalshi`).

import { describe, expect, test } from 'bun:test';
import { client } from '../../lib/clickhouse';
import { getCursor, getCursors, isDue, markRan, setCursor } from './cursor';

const RUN_INTEGRATION = !!process.env.KALSHI_API_TESTS;
const d = RUN_INTEGRATION ? describe : describe.skip;

const SCOPE_PREFIX = `__test_cursor_${Date.now()}_`;
const scope = (suffix: string) => `${SCOPE_PREFIX}${suffix}`;

d('cursor checkpoint round-trip against CH', () => {
    test('setCursor then getCursor recovers both ms + µs-ISO', async () => {
        const s = scope('roundtrip');
        const iso = '2026-06-01T17:00:00.123456Z';
        await setCursor(s, 'cursor-abc', iso);
        const got = await getCursor(s);
        expect(got).not.toBeNull();
        expect(got!.scope).toBe(s);
        expect(got!.last_cursor).toBe('cursor-abc');
        // µs precision survives the round-trip.
        expect(got!.last_processed_ts_iso).toBe(iso);
        // ms derivation strips the µs tail.
        expect(got!.last_processed_ts_ms).toBe(Date.parse(iso));
    });

    test('getCursor returns null for unknown scope', async () => {
        const got = await getCursor(scope('does-not-exist'));
        expect(got).toBeNull();
    });

    test('getCursors fetches multiple scopes in one query', async () => {
        const sA = scope('multi-a');
        const sB = scope('multi-b');
        await setCursor(sA, 'a', '2026-06-01T17:00:01.000000Z');
        await setCursor(sB, 'b', '2026-06-01T17:00:02.000000Z');
        const map = await getCursors([sA, sB, scope('multi-missing')]);
        expect(map.has(sA)).toBe(true);
        expect(map.has(sB)).toBe(true);
        expect(map.has(scope('multi-missing'))).toBe(false);
        expect(map.get(sA)!.last_cursor).toBe('a');
        expect(map.get(sB)!.last_cursor).toBe('b');
    });

    test('markRan stamps current time with an empty cursor', async () => {
        const s = scope('markRan');
        const before = Date.now();
        await markRan(s);
        const got = await getCursor(s);
        expect(got).not.toBeNull();
        expect(got!.last_cursor).toBe('');
        expect(got!.last_processed_ts_ms).toBeGreaterThanOrEqual(before);
        expect(got!.last_processed_ts_ms).toBeLessThanOrEqual(Date.now());
    });

    test('isDue with a freshly-stamped scope returns false', async () => {
        const s = scope('isDue-fresh');
        await markRan(s);
        const got = await getCursor(s);
        expect(isDue(got!.last_processed_ts_ms, 60)).toBe(false);
    });

    // CH ALTER ... DELETE is async by default; mutations_sync=2 waits for the
    // mutation to land before returning.
    test('cleanup test scopes', async () => {
        await client.command({
            query: `ALTER TABLE cursor_state DELETE WHERE startsWith(scope, {prefix:String})`,
            query_params: { prefix: SCOPE_PREFIX },
            clickhouse_settings: { mutations_sync: 2 },
        });
    });
});
