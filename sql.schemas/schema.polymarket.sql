-- Polymarket Markets Metadata
-- Stores market data fetched from Polymarket API using condition_id
CREATE TABLE IF NOT EXISTS polymarket_markets (
    -- identifiers --
    condition_id                String COMMENT 'Condition ID (bytes32 as hex with 0x prefix)',
    token0                      UInt256 COMMENT 'Token0 ID',
    token1                      UInt256 COMMENT 'Token1 ID',

    -- market metadata --
    market_id                   String COMMENT 'Polymarket market ID',
    question                    String COMMENT 'Market question',
    description                 String COMMENT 'Market description',
    market_slug                 String COMMENT 'Market slug for URL',
    outcomes                    String COMMENT 'Market outcomes JSON array',
    resolution_source           String COMMENT 'Resolution source URL',
    image                       String COMMENT 'Market image URL',
    icon                        String COMMENT 'Market icon URL',
    question_id                 String COMMENT 'Question ID (bytes32 as hex with 0x prefix)',
    clob_token_ids              String COMMENT 'CLOB token IDs JSON array',
    submitted_by                String COMMENT 'Address that submitted the market',
    enable_order_book           Bool COMMENT 'Whether order book is enabled',
    order_price_min_tick_size   Float64 COMMENT 'Minimum tick size for order prices',
    order_min_size              Float64 COMMENT 'Minimum order size',
    neg_risk                    Bool COMMENT 'Negative risk flag',
    neg_risk_request_id         String COMMENT 'Negative risk request ID',
    archived                    Bool COMMENT 'Whether the market is archived',

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
CREATE TABLE IF NOT EXISTS polymarket_assets (
    -- identifiers --
    asset_id                    UInt256 COMMENT 'Asset ID (token0 or token1)',
    condition_id                String COMMENT 'Condition ID (bytes32 as hex with 0x prefix)',

    -- inserter details --
    created_at                  DateTime('UTC') DEFAULT now(),
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (asset_id);

-- Polymarket Assets Errors
-- Tracks errors when market data cannot be fetched for a condition_id
CREATE TABLE IF NOT EXISTS polymarket_assets_errors (
    -- identifiers --
    condition_id                String COMMENT 'Condition ID (bytes32 as hex with 0x prefix)',
    token0                      UInt256 COMMENT 'Token0 ID',
    token1                      UInt256 COMMENT 'Token1 ID',

    -- error details --
    error_reason                String COMMENT 'Reason for the error',

    -- inserter details --
    created_at                  DateTime('UTC') DEFAULT now(),
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (condition_id);
