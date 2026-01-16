-- Polymarket Markets Metadata
-- Stores market data fetched from Polymarket API using condition_id
CREATE TABLE IF NOT EXISTS polymarket_markets (
    -- block --
    block_num                   UInt32,
    block_hash                  String,
    timestamp                   DateTime('UTC'),

    -- identifiers --
    condition_id                String COMMENT 'Condition ID (bytes32 as hex with 0x prefix)',
    token0                      UInt256 COMMENT 'Token0 ID',
    token1                      UInt256 COMMENT 'Token1 ID',

    -- market metadata --
    market_id                   String COMMENT 'Polymarket market ID',
    question                    String COMMENT 'Market question',
    description                 String COMMENT 'Market description',
    market_slug                 String COMMENT 'Market slug for URL',
    outcomes                    Array(String) COMMENT 'Market outcomes array',
    resolution_source           String COMMENT 'Resolution source URL',
    image                       String COMMENT 'Market image URL',
    icon                        String COMMENT 'Market icon URL',
    question_id                 String COMMENT 'Question ID (bytes32 as hex with 0x prefix)',
    clob_token_ids              Array(String) COMMENT 'CLOB token IDs array',
    outcome_prices              Array(String) COMMENT 'Outcome prices array',
    submitted_by                String COMMENT 'Address that submitted the market',
    market_maker_address        String COMMENT 'Market maker address',
    enable_order_book           Bool COMMENT 'Whether order book is enabled',
    order_price_min_tick_size   Float64 COMMENT 'Minimum tick size for order prices',
    order_min_size              Float64 COMMENT 'Minimum order size',
    neg_risk                    Bool COMMENT 'Negative risk flag',
    neg_risk_request_id         String COMMENT 'Negative risk request ID',
    neg_risk_other              Bool COMMENT 'Negative risk other flag',
    archived                    Bool COMMENT 'Whether the market is archived',
    new                         Bool COMMENT 'Whether the market is new',
    featured                    Bool COMMENT 'Whether the market is featured',
    resolved_by                 String COMMENT 'Address that resolved the market',
    restricted                  Bool COMMENT 'Whether the market is restricted',
    has_reviewed_dates          Bool COMMENT 'Whether the market has reviewed dates',
    uma_bond                    String COMMENT 'UMA bond amount',
    uma_reward                  String COMMENT 'UMA reward amount',
    custom_liveness             UInt32 COMMENT 'Custom liveness period in seconds',
    accepting_orders            Bool COMMENT 'Whether the market is accepting orders',
    ready                       Bool COMMENT 'Whether the market is ready',
    funded                      Bool COMMENT 'Whether the market is funded',
    accepting_orders_timestamp  String COMMENT 'Timestamp when market started accepting orders (ISO 8601)',
    cyom                        Bool COMMENT 'CYOM flag',
    competitive                 Float64 COMMENT 'Competitive score',
    pager_duty_notification_enabled Bool COMMENT 'Whether PagerDuty notifications are enabled',
    approved                    Bool COMMENT 'Whether the market is approved',
    rewards_min_size            Float64 COMMENT 'Minimum rewards size',
    rewards_max_spread          Float64 COMMENT 'Maximum rewards spread',
    spread                      Float64 COMMENT 'Market spread',
    automatically_active        Bool COMMENT 'Whether the market is automatically active',
    clear_book_on_start         Bool COMMENT 'Whether to clear order book on start',
    manual_activation           Bool COMMENT 'Whether the market requires manual activation',
    pending_deployment          Bool COMMENT 'Whether deployment is pending',
    deploying                   Bool COMMENT 'Whether the market is deploying',
    deploying_timestamp         String COMMENT 'Deployment timestamp (ISO 8601)',
    rfq_enabled                 Bool COMMENT 'Whether RFQ is enabled',
    event_start_time            String COMMENT 'Event start time (ISO 8601)',
    holding_rewards_enabled     Bool COMMENT 'Whether holding rewards are enabled',
    fees_enabled                Bool COMMENT 'Whether fees are enabled',
    requires_translation        Bool COMMENT 'Whether the market requires translation',

    -- dates --
    start_date                  String COMMENT 'Market start date (ISO 8601)',
    end_date                    String COMMENT 'Market end date (ISO 8601)',
    start_date_iso              String COMMENT 'Market start date (YYYY-MM-DD)',
    end_date_iso                String COMMENT 'Market end date (YYYY-MM-DD)',
    uma_end_date                String COMMENT 'UMA end date (ISO 8601)',
    created_at_api              String COMMENT 'Market creation timestamp from API',

    -- inserter details --
    created_at                  DateTime('UTC') DEFAULT now(),
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (condition_id);

-- Polymarket Assets
-- Links asset_id (token0/token1) to condition_id for lookup
CREATE TABLE IF NOT EXISTS polymarket_markets_by_asset_id (
    -- identifiers --
    asset_id                    UInt256 COMMENT 'Asset ID (token0 or token1)',
    condition_id                String COMMENT 'Condition ID (bytes32 as hex with 0x prefix)'
)
ENGINE = ReplacingMergeTree
ORDER BY (asset_id);

-- create MV to load data from polymarket_markets into polymarket_markets_by_asset_id
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_polymarket_markets_by_asset_id
TO polymarket_markets_by_asset_id AS
SELECT
    token0 AS asset_id,
    condition_id
FROM polymarket_markets
UNION ALL
SELECT
    token1 AS asset_id,
    condition_id
FROM polymarket_markets;

-- Polymarket Markets Errors
-- Tracks errors when market data cannot be fetched for a condition_id
CREATE TABLE IF NOT EXISTS polymarket_markets_errors (
    -- identifiers --
    condition_id                String COMMENT 'Condition ID (bytes32 as hex with 0x prefix)',
    token0                      UInt256 COMMENT 'Token0 ID',
    token1                      UInt256 COMMENT 'Token1 ID',

    -- error details --
    error                       String COMMENT 'Reason for the error',

    -- inserter details --
    created_at                  DateTime('UTC') DEFAULT now(),
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (condition_id);
