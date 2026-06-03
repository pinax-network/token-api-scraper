// Kalshi Trade API v2 response shapes.

export interface TradesPage {
    cursor: string;
    trades: Trade[];
}
export interface MarketsPage {
    cursor: string;
    markets: Market[];
}
export interface EventsPage {
    cursor: string;
    events: EventEntity[];
}
export interface SeriesPage {
    series: Series[];
}
export interface CandlesPage {
    ticker: string;
    candlesticks: Candlestick[];
}

/** Bulk-candlesticks endpoint groups bars per ticker. Note: `market_ticker`, not `ticker`. */
export interface BulkCandlesPage {
    markets: Array<{
        market_ticker: string;
        candlesticks: Candlestick[];
    }>;
}

export interface HistoricalCutoff {
    market_settled_ts: string;
    orders_updated_ts: string;
    trades_created_ts: string;
}

export interface Trade {
    trade_id: string;
    ticker: string;
    created_time: string;
    count_fp: string;
    yes_price_dollars: string;
    no_price_dollars: string;
    taker_outcome_side: 'yes' | 'no';
    taker_book_side: 'bid' | 'ask';
    taker_side?: string;
}

export interface Market {
    ticker: string;
    event_ticker: string;
    mve_collection_ticker?: string;
    market_type: 'binary' | 'scalar';
    status: string;
    title: string;
    yes_sub_title?: string;
    no_sub_title?: string;
    rules_primary?: string;
    rules_secondary?: string;

    created_time: string;
    open_time?: string;
    close_time?: string;
    expiration_time?: string;
    expected_expiration_time?: string;
    latest_expiration_time?: string;
    occurrence_datetime?: string;
    settlement_timer_seconds?: number;
    can_close_early?: boolean;

    result?: string;
    settlement_value_dollars?: string;
    expiration_value?: string;
    is_provisional?: boolean | null;

    yes_bid_dollars: string;
    yes_ask_dollars: string;
    no_bid_dollars: string;
    no_ask_dollars: string;
    last_price_dollars: string;
    previous_yes_bid_dollars?: string;
    previous_yes_ask_dollars?: string;
    previous_price_dollars?: string;

    yes_bid_size_fp?: string;
    yes_ask_size_fp?: string;

    volume_fp?: string;
    volume_24h_fp?: string;
    open_interest_fp?: string;

    notional_value_dollars?: string;
    price_level_structure?: string;
    response_price_units?: string;
    price_ranges?: PriceRange[];
    strike_type?: string;
    floor_strike?: number | null;
    cap_strike?: number | null;
    functional_strike?: string;

    updated_time: string;
}

export interface PriceRange {
    start: string;
    end: string;
    step: string;
}

export interface EventEntity {
    event_ticker: string;
    series_ticker: string;
    title: string;
    sub_title?: string;
    category?: string;
    mutually_exclusive?: boolean;
    collateral_return_type?: string;
    strike_date?: string;
    strike_period?: string;
    available_on_brokers?: boolean;
    last_updated_ts?: string;
    markets?: Market[];
}

export interface Series {
    ticker: string;
    title: string;
    category?: string;
    frequency?: string;
    fee_type?: string;
    fee_multiplier?: number; // observed fractional (0.5) on index series — keep number, not int
    tags?: string[];
    settlement_sources?: { name: string; url: string }[];
    additional_prohibitions?: string[];
    contract_terms_url?: string;
    contract_url?: string;
    product_metadata?: {
        important_info?: {
            id?: string;
            title?: string;
            message?: string;
            markdown?: string;
        };
    };
    last_updated_ts?: string;
}

export interface CandleOHLC {
    open_dollars: string;
    high_dollars: string;
    low_dollars: string;
    close_dollars: string;
}

export interface Candlestick {
    end_period_ts: number;
    volume_fp: string;
    open_interest_fp: string;
    price: CandleOHLC & { mean_dollars: string };
    yes_bid: CandleOHLC;
    yes_ask: CandleOHLC;
}
