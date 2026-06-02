// Kalshi sends sentinel `0001-01-01T00:00:00Z` for "never set" timestamps and
// empty strings for unresolved fields. CH DateTime64 can't store the sentinel
// and `WHERE x IS NULL` is cleaner than `x = ''`, so we normalize on write.

import type { Candlestick, EventEntity, Market, Series, Trade } from './types';

const SENTINEL_TS_PREFIX = '0001-01-01';

/** ISO 8601 timestamp → CH-acceptable form, or NULL if missing/sentinel. */
export function ts(s: string | null | undefined): string | null {
    if (!s) return null;
    if (s.startsWith(SENTINEL_TS_PREFIX)) return null;
    return s.replace(/Z$/, '');
}

/** Empty string → NULL. */
export function nullIfEmpty(s: string | null | undefined): string | null {
    return s ? s : null;
}

/** Decimal-string passthrough with a "0" floor for non-nullable columns. */
export function dec(s: string | null | undefined): string {
    return s ?? '0';
}

/** Decimal-string passthrough for nullable columns. */
export function decOptional(s: string | null | undefined): string | null {
    return s == null || s === '' ? null : s;
}

export function tradeRow(t: Trade) {
    return {
        trade_id: t.trade_id,
        ticker: t.ticker,
        created_time: ts(t.created_time),
        count_fp: dec(t.count_fp),
        yes_price_dollars: dec(t.yes_price_dollars),
        no_price_dollars: dec(t.no_price_dollars),
        taker_outcome_side: t.taker_outcome_side,
        taker_book_side: t.taker_book_side,
    };
}

export function marketRow(m: Market) {
    const pr = m.price_ranges ?? [];
    return {
        ticker: m.ticker,
        event_ticker: m.event_ticker,
        mve_collection_ticker: m.mve_collection_ticker ?? '',
        market_type: m.market_type,
        status: m.status,
        title: m.title,
        yes_sub_title: m.yes_sub_title ?? '',
        no_sub_title: m.no_sub_title ?? '',
        rules_primary: m.rules_primary ?? '',
        rules_secondary: m.rules_secondary ?? '',
        created_time: ts(m.created_time),
        open_time: ts(m.open_time),
        close_time: ts(m.close_time),
        expiration_time: ts(m.expiration_time),
        expected_expiration_time: ts(m.expected_expiration_time),
        latest_expiration_time: ts(m.latest_expiration_time),
        occurrence_datetime: ts(m.occurrence_datetime),
        settlement_timer_seconds: m.settlement_timer_seconds ?? 0,
        can_close_early: m.can_close_early ?? false,
        result: nullIfEmpty(m.result),
        settlement_value_dollars: decOptional(m.settlement_value_dollars),
        expiration_value: m.expiration_value ?? '',
        is_provisional: m.is_provisional ?? null,
        yes_bid_dollars: dec(m.yes_bid_dollars),
        yes_ask_dollars: dec(m.yes_ask_dollars),
        no_bid_dollars: dec(m.no_bid_dollars),
        no_ask_dollars: dec(m.no_ask_dollars),
        last_price_dollars: dec(m.last_price_dollars),
        previous_yes_bid_dollars: dec(m.previous_yes_bid_dollars),
        previous_yes_ask_dollars: dec(m.previous_yes_ask_dollars),
        previous_price_dollars: dec(m.previous_price_dollars),
        yes_bid_size_fp: dec(m.yes_bid_size_fp),
        yes_ask_size_fp: dec(m.yes_ask_size_fp),
        volume_fp: dec(m.volume_fp),
        volume_24h_fp: dec(m.volume_24h_fp),
        open_interest_fp: dec(m.open_interest_fp),
        notional_value_dollars: dec(m.notional_value_dollars),
        price_level_structure: m.price_level_structure ?? '',
        response_price_units: m.response_price_units ?? '',
        price_range_starts: pr.map((p) => p.start),
        price_range_ends: pr.map((p) => p.end),
        price_range_steps: pr.map((p) => p.step),
        strike_type: m.strike_type ?? '',
        floor_strike: m.floor_strike ?? null,
        cap_strike: m.cap_strike ?? null,
        functional_strike: m.functional_strike ?? '',
        updated_time: ts(m.updated_time),
    };
}

export function eventRow(e: EventEntity) {
    return {
        event_ticker: e.event_ticker,
        series_ticker: e.series_ticker,
        title: e.title,
        sub_title: e.sub_title ?? '',
        category: e.category ?? '',
        mutually_exclusive: e.mutually_exclusive ?? false,
        collateral_return_type: e.collateral_return_type ?? '',
        strike_date: ts(e.strike_date),
        strike_period: e.strike_period ?? '',
        available_on_brokers: e.available_on_brokers ?? false,
        last_updated_ts: ts(e.last_updated_ts),
    };
}

export function seriesRow(s: Series) {
    const sources = s.settlement_sources ?? [];
    const ii = s.product_metadata?.important_info ?? {};
    return {
        ticker: s.ticker,
        title: s.title,
        category: s.category ?? '',
        frequency: s.frequency ?? '',
        fee_type: s.fee_type ?? '',
        fee_multiplier: s.fee_multiplier ?? 1,
        tags: s.tags ?? [],
        settlement_source_names: sources.map((x) => x.name),
        settlement_source_urls: sources.map((x) => x.url),
        additional_prohibitions: s.additional_prohibitions ?? [],
        contract_terms_url: s.contract_terms_url ?? '',
        contract_url: s.contract_url ?? '',
        important_info_id: ii.id ?? '',
        important_info_title: ii.title ?? '',
        important_info_message: ii.message ?? '',
        important_info_markdown: ii.markdown ?? '',
        last_updated_ts: ts(s.last_updated_ts),
    };
}

/** Map Kalshi's int period_interval (1/60/1440) to the CH Enum16 label. */
const PERIOD_LABEL = {
    1: '1m',
    60: '60m',
    1440: '1440m',
} as const satisfies Record<number, '1m' | '60m' | '1440m'>;

export type PeriodInterval = keyof typeof PERIOD_LABEL;

export function candleRow(
    ticker: string,
    period: PeriodInterval,
    c: Candlestick,
) {
    const label = PERIOD_LABEL[period];
    if (!label) {
        throw new Error(`candleRow: unsupported period_interval ${period}`);
    }
    return {
        ticker,
        period_interval: label,
        end_period_ts: c.end_period_ts,
        price_open_dollars: c.price.open_dollars,
        price_high_dollars: c.price.high_dollars,
        price_low_dollars: c.price.low_dollars,
        price_close_dollars: c.price.close_dollars,
        price_mean_dollars: c.price.mean_dollars,
        yes_bid_open_dollars: c.yes_bid.open_dollars,
        yes_bid_high_dollars: c.yes_bid.high_dollars,
        yes_bid_low_dollars: c.yes_bid.low_dollars,
        yes_bid_close_dollars: c.yes_bid.close_dollars,
        yes_ask_open_dollars: c.yes_ask.open_dollars,
        yes_ask_high_dollars: c.yes_ask.high_dollars,
        yes_ask_low_dollars: c.yes_ask.low_dollars,
        yes_ask_close_dollars: c.yes_ask.close_dollars,
        volume_fp: c.volume_fp,
        open_interest_fp: c.open_interest_fp,
    };
}
