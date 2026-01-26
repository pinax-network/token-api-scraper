-- Raw Token Metadata from Solana RPC
CREATE TABLE IF NOT EXISTS metadata (
    -- block --
    block_num                   UInt32,
    timestamp                   DateTime('UTC'),

    -- token identity --
    network                     LowCardinality(String),
    contract                    String,
    source                      LowCardinality(String) DEFAULT '',

    -- token metadata (required) --
    decimals                    UInt8,

    -- token metadata (optional) --
    name                        String DEFAULT '',
    symbol                      String DEFAULT '',

    -- token metadata from external URL (optional) --
    uri                         String DEFAULT '',
    image                       String DEFAULT '',
    description                 String DEFAULT '',

    -- inserter details --
    created_at                  DateTime('UTC') DEFAULT now()
)
ENGINE = ReplacingMergeTree(block_num)
ORDER BY (
    network, contract
);

-- RPC error handling for metadata --
CREATE TABLE IF NOT EXISTS metadata_errors (
    network                     String,
    contract                    String,
    error                       LowCardinality(String) DEFAULT '',
    created_at                  DateTime('UTC') DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
TTL created_at + INTERVAL 1 WEEK
ORDER BY ( network, contract );