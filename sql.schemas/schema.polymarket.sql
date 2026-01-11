-- Polymarket Markets Metadata
-- Stores market data fetched from Polymarket API using condition_id
CREATE TABLE IF NOT EXISTS polymarket_markets (
    -- identifiers --
    condition_id                String COMMENT 'Condition ID (bytes32 as hex with 0x prefix)',
    token0                      UInt256 COMMENT 'Token0 ID',
    token1                      UInt256 COMMENT 'Token1 ID',

    -- market metadata --
    question                    String COMMENT 'Market question',
    description                 String COMMENT 'Market description',
    market_slug                 String COMMENT 'Market slug for URL',
    end_date_iso                String COMMENT 'Market end date in ISO format',
    game_start_time             String COMMENT 'Game start time if applicable',
    seconds_delay               UInt32 COMMENT 'Seconds delay for resolution',
    fpmm                        String COMMENT 'Fixed Product Market Maker address',
    maker_base_fee              UInt32 COMMENT 'Maker base fee',
    taker_base_fee              UInt32 COMMENT 'Taker base fee',
    clob_rewards                String COMMENT 'CLOB rewards JSON',
    active                      Bool COMMENT 'Whether the market is active',
    closed                      Bool COMMENT 'Whether the market is closed',
    archived                    Bool COMMENT 'Whether the market is archived',
    accepting_orders            Bool COMMENT 'Whether the market is accepting orders',
    accepting_order_timestamp   String COMMENT 'Timestamp when market started accepting orders',
    minimum_order_size          Float64 COMMENT 'Minimum order size',
    minimum_tick_size           Float64 COMMENT 'Minimum tick size',
    neg_risk                    Bool COMMENT 'Negative risk flag',
    neg_risk_market_id          String COMMENT 'Negative risk market ID',
    neg_risk_request_id         String COMMENT 'Negative risk request ID',
    notification_preferences    String COMMENT 'Notification preferences JSON',
    notifications_enabled       Bool COMMENT 'Whether notifications are enabled',
    competitive                 Float64 COMMENT 'Competitive score',
    spread                      Float64 COMMENT 'Spread',
    last_trade_price            Float64 COMMENT 'Last trade price',
    best_bid                    Float64 COMMENT 'Best bid price',
    best_ask                    Float64 COMMENT 'Best ask price',
    price                       Float64 COMMENT 'Current price',
    volume                      Float64 COMMENT 'Trading volume (parsed from API string)',
    volume_num                  Float64 COMMENT 'Trading volume (numeric value from API)',
    liquidity                   Float64 COMMENT 'Market liquidity (parsed from API string)',
    liquidity_num               Float64 COMMENT 'Market liquidity (numeric value from API)',

    -- inserter details --
    created_at                  DateTime('UTC') DEFAULT now(),
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (condition_id);

-- Polymarket Assets
-- Links asset_id (token0/token1) to condition_id for lookup
CREATE TABLE IF NOT EXISTS polymarket_assets (
    -- identifiers --
    asset_id                    UInt256 COMMENT 'Asset ID (token0 or token1)',
    condition_id                String COMMENT 'Condition ID (bytes32 as hex with 0x prefix)',

    -- inserter details --
    created_at                  DateTime('UTC') DEFAULT now(),
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (asset_id);
