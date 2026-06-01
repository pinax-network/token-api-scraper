// Integration tests against the live Kalshi Trade API. Gated by
// `KALSHI_API_TESTS=1` — set this env var in release pipelines, leave unset
// (default-off) in PR CI so contributors don't depend on Kalshi being up.

import { describe, expect, test } from 'bun:test';
import { KalshiClient } from './client';

const RUN_INTEGRATION = !!process.env.KALSHI_API_TESTS;
const d = RUN_INTEGRATION ? describe : describe.skip;

d('KalshiClient against the live API', () => {
    const c = new KalshiClient();

    test('getHistoricalCutoff returns the three ts fields', async () => {
        const cutoff = await c.getHistoricalCutoff();
        expect(cutoff.trades_created_ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(cutoff.market_settled_ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(cutoff.orders_updated_ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('getTradesLive returns shape-compatible rows + cursor', async () => {
        const page = await c.getTradesLive({ limit: 5 });
        expect(Array.isArray(page.trades)).toBe(true);
        expect(typeof page.cursor).toBe('string');
        if (page.trades.length > 0) {
            const t = page.trades[0];
            expect(typeof t.trade_id).toBe('string');
            expect(typeof t.ticker).toBe('string');
            expect(t.created_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(typeof t.count_fp).toBe('string');
            expect(typeof t.yes_price_dollars).toBe('string');
            expect(['yes', 'no']).toContain(t.taker_outcome_side);
            expect(['bid', 'ask']).toContain(t.taker_book_side);
        }
    });

    test('getMarkets returns shape-compatible rows', async () => {
        const page = await c.getMarkets({ limit: 3 });
        expect(Array.isArray(page.markets)).toBe(true);
        if (page.markets.length > 0) {
            const m = page.markets[0];
            expect(typeof m.ticker).toBe('string');
            expect(['binary', 'scalar']).toContain(m.market_type);
            // Status field uses stored vocab (active/closed/finalized/etc),
            // not filter vocab (open/closed/settled).
            expect(typeof m.status).toBe('string');
        }
    });

    test('getEvents returns shape-compatible rows', async () => {
        const page = await c.getEvents({ limit: 3 });
        expect(Array.isArray(page.events)).toBe(true);
        if (page.events.length > 0) {
            const e = page.events[0];
            expect(typeof e.event_ticker).toBe('string');
            expect(typeof e.series_ticker).toBe('string');
        }
    });

    // 15s timeout: ~14MB response + JSON parse can exceed Bun's 5s default.
    test('getSeries returns the full catalogue in one shot', async () => {
        const page = await c.getSeries();
        // Universe has been ~10K+ since at least 2026-05.
        expect(page.series.length).toBeGreaterThan(1000);
        const s = page.series[0];
        expect(typeof s.ticker).toBe('string');
        expect(typeof s.title).toBe('string');
        // fee_multiplier observed as both int and float across the corpus —
        // either is acceptable but it MUST be a number when present.
        if (s.fee_multiplier != null) {
            expect(typeof s.fee_multiplier).toBe('number');
        }
    }, 15_000);

    test('cursor pagination on /markets/trades advances forward', async () => {
        const first = await c.getTradesLive({ limit: 100 });
        if (!first.cursor || first.trades.length === 0) {
            // No data window — skip.
            return;
        }
        const second = await c.getTradesLive({
            limit: 100,
            cursor: first.cursor,
        });
        // Different page implies different trades; spot-check at least one
        // trade_id differs across pages.
        const firstIds = new Set(first.trades.map((t) => t.trade_id));
        const overlap = second.trades.filter((t) => firstIds.has(t.trade_id));
        expect(overlap.length).toBeLessThan(second.trades.length);
    });
});
