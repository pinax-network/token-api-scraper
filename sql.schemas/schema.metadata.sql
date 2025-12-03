-- Raw Token Metadata from RPC
CREATE TABLE IF NOT EXISTS metadata (
    -- block --
    block_num                   UInt32 COMMENT 'block number from last successful transfer/swap involving this token',

    -- token metadata --
    contract                    String,
    decimals                    UInt8,
    name                        String,
    symbol                      String,

    -- inserter details --
    created_at                  DateTime('UTC') DEFAULT now(),
)
ENGINE = ReplacingMergeTree(block_num)
ORDER BY (
    contract
);

-- RPC error handling for metadata --
CREATE TABLE IF NOT EXISTS metadata_errors (
    contract                    String,
    error                       LowCardinality(String) DEFAULT '',
    created_at                  DateTime('UTC') DEFAULT now(),
)
ENGINE = MergeTree
ORDER BY (
    contract
);
