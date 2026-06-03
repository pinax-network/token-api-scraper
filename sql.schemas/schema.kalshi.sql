-- Kalshi prediction-market data (scraped from Kalshi Trade API v2).
--
-- Populated by two scraper services polling the public REST API
-- (https://api.elections.kalshi.com/trade-api/v2/*): `kalshi-live` tip-follows
-- /markets/trades, /markets, /events, /series, and /markets/candlesticks;
-- `kalshi-backfill` walks /historical/trades from the cutoff backward into the
-- same `trades` table. No auth required for any market-data endpoint used here.
--
-- Apply via: npm run cli setup kalshi --clickhouse-database <db>

-- ============================================================
-- Series — Kalshi recurring contract templates (~10K rows, slow-changing).
-- ============================================================
CREATE TABLE IF NOT EXISTS series (
    ticker                      String                          COMMENT 'series ticker (e.g. KXHIGHNY), unique',
    title                       String,
    category                    LowCardinality(String)          COMMENT 'Politics / Sports / Climate and Weather / Crypto / Entertainment / ...',
    frequency                   LowCardinality(String)          COMMENT 'one_off | daily | weekly | ...',
    fee_type                    LowCardinality(String)          COMMENT 'quadratic | ...',
    fee_multiplier              Float64                         COMMENT 'observed fractional values (0.5) for index series — must be Float, not Int',
    tags                        Array(String),
    settlement_source_names     Array(String)                   COMMENT 'parallel array with settlement_source_urls',
    settlement_source_urls      Array(String),
    additional_prohibitions     Array(String),
    contract_terms_url          String,
    contract_url                String,
    important_info_id           String                          COMMENT 'product_metadata.important_info.* (flattened)',
    important_info_title        String,
    important_info_message      String,
    important_info_markdown     String,

    last_updated_ts             Nullable(DateTime64(6, 'UTC'))  COMMENT 'source-provided, sentinel 0001-01-01 coerced to NULL on write',
    ingested_at                 DateTime64(6, 'UTC') DEFAULT now64(6)
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY ticker
COMMENT 'Kalshi series catalogue (scraper-managed)';

-- ============================================================
-- Events — one real-world occurrence; groups one or more markets.
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
    event_ticker                String                          COMMENT 'e.g. KXBTC15M-26JUN011215',
    series_ticker               String                          COMMENT 'FK to series.ticker',
    title                       String,
    sub_title                   String,
    category                    LowCardinality(String),
    mutually_exclusive          Bool,
    collateral_return_type      LowCardinality(String),
    strike_date                 Nullable(DateTime64(6, 'UTC')),
    strike_period               String,
    available_on_brokers        Bool,

    last_updated_ts             Nullable(DateTime64(6, 'UTC'))  COMMENT 'source-provided, sentinel 0001-01-01 coerced to NULL on write',
    ingested_at                 DateTime64(6, 'UTC') DEFAULT now64(6)
)
ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY event_ticker
COMMENT 'Kalshi event metadata (scraper-managed)';

-- ============================================================
-- Markets — binary or scalar contracts. Latest state per ticker.
-- ============================================================
CREATE TABLE IF NOT EXISTS markets (
    ticker                      String                          COMMENT 'unique market ticker (e.g. KXBTC15M-26JUN011215-15)',
    event_ticker                String                          COMMENT 'FK to events.event_ticker',
    mve_collection_ticker       String                          COMMENT 'multivariate event collection, empty for non-multivariate',
    market_type                 LowCardinality(String)          COMMENT 'binary | scalar',
    status                      LowCardinality(String)          COMMENT 'Kalshi stored vocab is initialized/active/inactive/closed/finalized, filter vocab differs (unopened/open/paused/closed/settled)',
    title                       String,
    yes_sub_title               String,
    no_sub_title                String,
    rules_primary               String,
    rules_secondary             String,

    created_time                DateTime64(6, 'UTC'),
    open_time                   Nullable(DateTime64(6, 'UTC')),
    close_time                  Nullable(DateTime64(6, 'UTC')),
    expiration_time             Nullable(DateTime64(6, 'UTC')),
    expected_expiration_time    Nullable(DateTime64(6, 'UTC')),
    latest_expiration_time      Nullable(DateTime64(6, 'UTC')),
    occurrence_datetime         Nullable(DateTime64(6, 'UTC')),
    settlement_timer_seconds    Int32,
    can_close_early             Bool,

    result                      Nullable(String)                COMMENT 'yes/no/scalar/NULL when unresolved, empty string coerced to NULL on write',
    settlement_value_dollars    Nullable(Decimal(18, 6)),
    expiration_value            String,
    is_provisional              Nullable(Bool),

    yes_bid_dollars             Decimal(18, 6)                  COMMENT 'FixedPointDollars (docs cap 6dp, observed 4dp)',
    yes_ask_dollars             Decimal(18, 6),
    no_bid_dollars              Decimal(18, 6),
    no_ask_dollars              Decimal(18, 6),
    last_price_dollars          Decimal(18, 6),
    previous_yes_bid_dollars    Decimal(18, 6),
    previous_yes_ask_dollars    Decimal(18, 6),
    previous_price_dollars      Decimal(18, 6),

    yes_bid_size_fp             Decimal(18, 4)                  COMMENT 'FixedPointCount (2dp per docs, scale headroom)',
    yes_ask_size_fp             Decimal(18, 4),

    volume_fp                   Decimal(18, 4),
    volume_24h_fp               Decimal(18, 4),
    open_interest_fp            Decimal(18, 4),

    notional_value_dollars      Decimal(18, 6)                  COMMENT 'settlement value per contract (typically $1.00)',
    price_level_structure       LowCardinality(String),
    response_price_units        LowCardinality(String),
    price_range_starts          Array(Decimal(18, 6))           COMMENT 'parallel arrays from price_ranges[].{start,end,step}',
    price_range_ends            Array(Decimal(18, 6)),
    price_range_steps           Array(Decimal(18, 6)),
    strike_type                 LowCardinality(String),
    floor_strike                Nullable(Float64),
    cap_strike                  Nullable(Float64),
    functional_strike           String,

    updated_time                DateTime64(6, 'UTC')            COMMENT 'source-provided, used as merge tie-breaker via ingested_at version',
    ingested_at                 DateTime64(6, 'UTC') DEFAULT now64(6)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(created_time)
ORDER BY ticker
COMMENT 'Kalshi markets latest-state (scraper-managed)';

-- ============================================================
-- Trades — append-only fill history.
-- ============================================================
CREATE TABLE IF NOT EXISTS trades (
    trade_id                    UUID                            COMMENT 'Kalshi trade identifier',
    ticker                      String                          COMMENT 'FK to markets.ticker',
    created_time                DateTime64(6, 'UTC')            COMMENT 'fill time (μs precision)',
    count_fp                    Decimal(18, 4)                  COMMENT 'contracts (FixedPointCount)',
    yes_price_dollars           Decimal(18, 6),
    no_price_dollars            Decimal(18, 6)                  COMMENT 'yes + no = 1.0000',
    taker_outcome_side          Enum8('yes' = 1, 'no' = 2),
    taker_book_side             Enum8('bid' = 1, 'ask' = 2),

    ingested_at                 DateTime64(6, 'UTC') DEFAULT now64(6)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(created_time)
ORDER BY (ticker, created_time, trade_id)
COMMENT 'Kalshi trade fills (scraper-managed). RMT dedups on (ticker, created_time, trade_id) for retry-safe inserts. Use FINAL on read only when exact aggregation matters.';

-- ============================================================
-- Candlesticks — server-aggregated 1m / 60m / 1440m bars.
-- ============================================================
CREATE TABLE IF NOT EXISTS candlesticks (
    ticker                      String,
    period_interval             Enum16('1m' = 1, '60m' = 60, '1440m' = 1440) COMMENT 'Kalshi period_interval in minutes',
    end_period_ts               DateTime('UTC')                 COMMENT 'bar close time (unix int from source)',

    price_open_dollars          Decimal(18, 6)                  COMMENT 'OHLC on YES price',
    price_high_dollars          Decimal(18, 6),
    price_low_dollars           Decimal(18, 6),
    price_close_dollars         Decimal(18, 6),
    price_mean_dollars          Decimal(18, 6),

    yes_bid_open_dollars        Decimal(18, 6)                  COMMENT 'OHLC on top-of-book bid',
    yes_bid_high_dollars        Decimal(18, 6),
    yes_bid_low_dollars         Decimal(18, 6),
    yes_bid_close_dollars       Decimal(18, 6),

    yes_ask_open_dollars        Decimal(18, 6)                  COMMENT 'OHLC on top-of-book ask',
    yes_ask_high_dollars        Decimal(18, 6),
    yes_ask_low_dollars         Decimal(18, 6),
    yes_ask_close_dollars       Decimal(18, 6),

    volume_fp                   Decimal(18, 4),
    open_interest_fp            Decimal(18, 4)                  COMMENT 'OI at bar close',

    ingested_at                 DateTime64(6, 'UTC') DEFAULT now64(6)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY (period_interval, toYYYYMM(end_period_ts))
ORDER BY (ticker, period_interval, end_period_ts)
COMMENT 'Kalshi server-aggregated candlesticks (scraper-managed)';

-- ============================================================
-- Cursor checkpoints — resumable polling across restarts.
-- ============================================================
CREATE TABLE IF NOT EXISTS cursor_state (
    scope                       String                          COMMENT 'logical scope, e.g. trades_live | trades_backfill | markets_refresh | events_refresh | series_refresh | candles_refresh',
    last_cursor                 String                          COMMENT 'opaque Kalshi cursor token, or __DRAINED__/__POISONED__ sentinel for terminal states',
    last_processed_ts           DateTime64(6, 'UTC')            COMMENT 'for data-walking scopes: created_time of the last processed item; for refresh scopes: last successful run time',
    updated_at                  DateTime64(6, 'UTC') DEFAULT now64(6)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY scope
COMMENT 'Per-scope cursor checkpoints for the kalshi scraper';
