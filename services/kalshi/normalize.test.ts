import { describe, expect, test } from 'bun:test';
import {
    candleRow,
    dec,
    decOptional,
    eventRow,
    marketRow,
    nullIfEmpty,
    seriesRow,
    tradeRow,
    ts,
} from './normalize';
import type { Candlestick, EventEntity, Market, Series, Trade } from './types';

describe('ts (sentinel + format coercion)', () => {
    test('strips trailing Z', () => {
        expect(ts('2026-06-01T17:00:00.123456Z')).toBe(
            '2026-06-01T17:00:00.123456',
        );
    });

    test('coerces the Kalshi 0001-01-01 sentinel to null', () => {
        expect(ts('0001-01-01T00:00:00Z')).toBeNull();
        expect(ts('0001-01-01T00:00:00.000000Z')).toBeNull();
    });

    test('handles missing input', () => {
        expect(ts(undefined)).toBeNull();
        expect(ts(null)).toBeNull();
        expect(ts('')).toBeNull();
    });

    test('passes through non-Z-suffixed ISO strings unchanged', () => {
        expect(ts('2026-06-01T17:00:00.123456')).toBe(
            '2026-06-01T17:00:00.123456',
        );
    });
});

describe('nullIfEmpty', () => {
    test('coerces empty string to null', () => {
        expect(nullIfEmpty('')).toBeNull();
    });

    test('passes through non-empty', () => {
        expect(nullIfEmpty('yes')).toBe('yes');
        expect(nullIfEmpty('no')).toBe('no');
    });

    test('handles missing input', () => {
        expect(nullIfEmpty(undefined)).toBeNull();
        expect(nullIfEmpty(null)).toBeNull();
    });
});

describe('dec', () => {
    test('passes through decimal strings', () => {
        expect(dec('0.0170')).toBe('0.0170');
        expect(dec('14.00')).toBe('14.00');
    });

    test("defaults to '0' for missing input", () => {
        expect(dec(undefined)).toBe('0');
        expect(dec(null)).toBe('0');
    });

    test('keeps empty string (intentional: empty != missing for some callers)', () => {
        // dec uses ?? — explicit empty string is preserved.
        expect(dec('')).toBe('');
    });
});

describe('decOptional', () => {
    test('passes through decimal strings', () => {
        expect(decOptional('1.234567')).toBe('1.234567');
    });

    test('coerces empty + missing to null', () => {
        expect(decOptional('')).toBeNull();
        expect(decOptional(undefined)).toBeNull();
        expect(decOptional(null)).toBeNull();
    });
});

// ----- row builders -----

const TRADE_FIXTURE: Trade = {
    trade_id: '3d3e898f-d385-41f5-b6d2-1ddc66a87076',
    ticker: 'KXBTC15M-26JUN011215-15',
    created_time: '2026-06-01T16:10:42.233435Z',
    count_fp: '14.00',
    yes_price_dollars: '0.0170',
    no_price_dollars: '0.9830',
    taker_outcome_side: 'yes',
    taker_book_side: 'bid',
};

describe('tradeRow', () => {
    test('strips Z from created_time', () => {
        const row = tradeRow(TRADE_FIXTURE);
        expect(row.created_time).toBe('2026-06-01T16:10:42.233435');
    });

    test('preserves decimal precision verbatim', () => {
        const row = tradeRow(TRADE_FIXTURE);
        expect(row.yes_price_dollars).toBe('0.0170');
        expect(row.no_price_dollars).toBe('0.9830');
        expect(row.count_fp).toBe('14.00');
    });

    test('preserves taker_outcome_side and taker_book_side as Enum labels', () => {
        const row = tradeRow(TRADE_FIXTURE);
        expect(row.taker_outcome_side).toBe('yes');
        expect(row.taker_book_side).toBe('bid');
    });
});

const MARKET_FIXTURE: Market = {
    ticker: 'KXBTC15M-26JUN011215-15',
    event_ticker: 'KXBTC15M-26JUN011215',
    market_type: 'binary',
    status: 'active',
    title: 'BTC price up in next 15 mins?',
    created_time: '2026-06-01T00:01:43.225007Z',
    open_time: '2026-06-01T16:00:00Z',
    close_time: '2026-06-01T16:15:00Z',
    yes_bid_dollars: '0.0130',
    yes_ask_dollars: '0.0170',
    no_bid_dollars: '0.9830',
    no_ask_dollars: '0.9870',
    last_price_dollars: '0.0170',
    updated_time: '2026-06-01T16:00:02.123147Z',
    price_ranges: [
        { start: '0.0000', end: '0.1000', step: '0.0010' },
        { start: '0.1000', end: '0.9000', step: '0.0100' },
        { start: '0.9000', end: '1.0000', step: '0.0010' },
    ],
    result: '',
    expiration_value: '',
};

describe('marketRow', () => {
    test('coerces empty result to null', () => {
        expect(marketRow(MARKET_FIXTURE).result).toBeNull();
    });

    test('flattens price_ranges to parallel arrays', () => {
        const row = marketRow(MARKET_FIXTURE);
        expect(row.price_range_starts).toEqual(['0.0000', '0.1000', '0.9000']);
        expect(row.price_range_ends).toEqual(['0.1000', '0.9000', '1.0000']);
        expect(row.price_range_steps).toEqual(['0.0010', '0.0100', '0.0010']);
    });

    test('missing price_ranges produces empty arrays (not null)', () => {
        const row = marketRow({ ...MARKET_FIXTURE, price_ranges: undefined });
        expect(row.price_range_starts).toEqual([]);
        expect(row.price_range_ends).toEqual([]);
        expect(row.price_range_steps).toEqual([]);
    });

    test('preserves Kalshi-vocab status as-returned', () => {
        // Kalshi filter values (`open`) and stored values (`active`) differ;
        // we keep what Kalshi gives us and translate at the API layer.
        expect(marketRow(MARKET_FIXTURE).status).toBe('active');
        expect(
            marketRow({ ...MARKET_FIXTURE, status: 'finalized' }).status,
        ).toBe('finalized');
    });

    test('strips Z on every timestamp field', () => {
        const row = marketRow(MARKET_FIXTURE);
        expect(row.created_time).toBe('2026-06-01T00:01:43.225007');
        expect(row.open_time).toBe('2026-06-01T16:00:00');
        expect(row.close_time).toBe('2026-06-01T16:15:00');
        expect(row.updated_time).toBe('2026-06-01T16:00:02.123147');
    });
});

const EVENT_FIXTURE: EventEntity = {
    event_ticker: 'KXBTC15M-26JUN011215',
    series_ticker: 'KXBTC15M',
    title: 'BTC 15 min',
    sub_title: 'Jun 1 12:00-12:15 EDT',
    mutually_exclusive: false,
    last_updated_ts: '2026-06-01T15:00:00Z',
};

describe('eventRow', () => {
    test('preserves event_ticker + series_ticker', () => {
        const row = eventRow(EVENT_FIXTURE);
        expect(row.event_ticker).toBe('KXBTC15M-26JUN011215');
        expect(row.series_ticker).toBe('KXBTC15M');
    });

    test('coerces 0001-01-01 sentinel last_updated_ts to null', () => {
        const row = eventRow({
            ...EVENT_FIXTURE,
            last_updated_ts: '0001-01-01T00:00:00Z',
        });
        expect(row.last_updated_ts).toBeNull();
    });

    test('defaults optional fields to empty string / false', () => {
        const minimal: EventEntity = {
            event_ticker: 'X-1',
            series_ticker: 'X',
            title: 'T',
        };
        const row = eventRow(minimal);
        expect(row.sub_title).toBe('');
        expect(row.mutually_exclusive).toBe(false);
        expect(row.available_on_brokers).toBe(false);
    });
});

const SERIES_FIXTURE: Series = {
    ticker: 'KXHIGHNY',
    title: 'Highest temperature in NYC',
    category: 'Climate and Weather',
    frequency: 'daily',
    fee_type: 'quadratic',
    fee_multiplier: 1,
    tags: ['Daily temperature'],
    settlement_sources: [
        { name: 'NWS Climatological Report', url: 'https://example.com/nws' },
    ],
    additional_prohibitions: ['Prohibition A'],
    contract_terms_url: 'https://example.com/terms.pdf',
    contract_url: 'https://example.com/contract.pdf',
    product_metadata: {
        important_info: {
            id: 'WEATHER-2025-3-3',
            title: 'Important: ',
            message: 'Not all weather data is the same.',
            markdown: '**Important information**',
        },
    },
    last_updated_ts: '2026-03-16T15:04:55.113254Z',
};

describe('seriesRow', () => {
    test('flattens settlement_sources to parallel arrays', () => {
        const row = seriesRow(SERIES_FIXTURE);
        expect(row.settlement_source_names).toEqual([
            'NWS Climatological Report',
        ]);
        expect(row.settlement_source_urls).toEqual(['https://example.com/nws']);
    });

    test('flattens product_metadata.important_info into individual columns', () => {
        const row = seriesRow(SERIES_FIXTURE);
        expect(row.important_info_id).toBe('WEATHER-2025-3-3');
        expect(row.important_info_title).toBe('Important: ');
        expect(row.important_info_message).toBe(
            'Not all weather data is the same.',
        );
        expect(row.important_info_markdown).toBe('**Important information**');
    });

    test('handles missing product_metadata cleanly', () => {
        const row = seriesRow({
            ...SERIES_FIXTURE,
            product_metadata: undefined,
        });
        expect(row.important_info_id).toBe('');
        expect(row.important_info_title).toBe('');
        expect(row.important_info_message).toBe('');
        expect(row.important_info_markdown).toBe('');
    });

    test('preserves fractional fee_multiplier (Float64 schema)', () => {
        // 9 of ~10K series (index futures) carry 0.5 — must not be int-cast.
        const row = seriesRow({ ...SERIES_FIXTURE, fee_multiplier: 0.5 });
        expect(row.fee_multiplier).toBe(0.5);
    });

    test('defaults fee_multiplier to 1 when missing', () => {
        const row = seriesRow({ ...SERIES_FIXTURE, fee_multiplier: undefined });
        expect(row.fee_multiplier).toBe(1);
    });
});

const CANDLE_FIXTURE: Candlestick = {
    end_period_ts: 1780329660,
    volume_fp: '38015.34',
    open_interest_fp: '23913.03',
    price: {
        open_dollars: '0.5500',
        high_dollars: '0.7400',
        low_dollars: '0.5100',
        close_dollars: '0.6600',
        mean_dollars: '0.6569',
    },
    yes_bid: {
        open_dollars: '0.0000',
        high_dollars: '0.7300',
        low_dollars: '0.0000',
        close_dollars: '0.6500',
    },
    yes_ask: {
        open_dollars: '0.9990',
        high_dollars: '0.9990',
        low_dollars: '0.5100',
        close_dollars: '0.6600',
    },
};

describe('candleRow', () => {
    test("maps period 1 to Enum16 label '1m'", () => {
        expect(candleRow('X', 1, CANDLE_FIXTURE).period_interval).toBe('1m');
    });

    test("maps period 60 to '60m'", () => {
        expect(candleRow('X', 60, CANDLE_FIXTURE).period_interval).toBe('60m');
    });

    test("maps period 1440 to '1440m'", () => {
        expect(candleRow('X', 1440, CANDLE_FIXTURE).period_interval).toBe(
            '1440m',
        );
    });

    test('flattens nested OHLC objects into prefixed columns', () => {
        const row = candleRow('X', 1, CANDLE_FIXTURE);
        expect(row.price_open_dollars).toBe('0.5500');
        expect(row.price_close_dollars).toBe('0.6600');
        expect(row.price_mean_dollars).toBe('0.6569');
        expect(row.yes_bid_open_dollars).toBe('0.0000');
        expect(row.yes_ask_close_dollars).toBe('0.6600');
    });

    test('passes ticker + end_period_ts through unchanged', () => {
        const row = candleRow('KXBTC15M-Y', 60, CANDLE_FIXTURE);
        expect(row.ticker).toBe('KXBTC15M-Y');
        expect(row.end_period_ts).toBe(1780329660);
    });
});
