-- Raw Token Metadata from Solana RPC
CREATE TABLE IF NOT EXISTS metadata (
    -- block --
    block_num                   UInt32,
    timestamp                   DateTime('UTC'),

    -- token identity --
    network                     String,
    contract                    String,

    -- token metadata --
    decimals                    UInt8,
    name                        String,
    symbol                      String,
    uri                         String,
    source                      Enum8('metaplex' = 0, 'token2022' = 1, 'none' = 2, 'burned' = 3, 'pump-amm' = 4),

    -- parsed token metadata --
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