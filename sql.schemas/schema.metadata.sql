-- Raw Token Metadata from RPC
CREATE TABLE IF NOT EXISTS metadata_rpc (
    -- block --
    block_num                   UInt32 DEFAULT 0 COMMENT 'block number',
    block_hash                  String DEFAULT '' COMMENT 'block hash',
    timestamp                   DateTime('UTC') DEFAULT now() COMMENT 'block timestamp',
    minute                      UInt32 DEFAULT toRelativeMinuteNum(timestamp),

    -- token metadata --
    contract                    String,
    decimals_hex                String,
    name_hex                    String,
    symbol_hex                  String,

    -- decoded, with error-tolerant defaults --
    decimals                    UInt8 MATERIALIZED hex_to_uint8(decimals_hex),
    name                        String MATERIALIZED hex_to_string(name_hex),
    symbol                      String MATERIALIZED hex_to_string(symbol_hex),

    -- error handling --
    created_at                  DateTime('UTC') DEFAULT now(),
    error_msg                   LowCardinality(String) DEFAULT '',
    is_ok                       UInt8 DEFAULT error_msg = '',

    -- PROJECTIONS --
    PROJECTION prj_contract_error_stats (
        SELECT contract, is_ok, count(), min(timestamp), max(timestamp)
        GROUP BY contract, is_ok
    )
)
ENGINE = MergeTree
ORDER BY (
    contract, block_num
);

-- Insert Native TRX
INSERT INTO metadata_rpc (
    contract,
    decimals_hex,
    name_hex,
    symbol_hex
)
-- 6/Tron/TRX
VALUES (
    'T0000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000000000000000000000000000006',
    '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000454726f6e00000000000000000000000000000000000000000000000000000000',
    '0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000035452580000000000000000000000000000000000000000000000000000000000',
);


-- Final Token Metadata from RPC
CREATE TABLE IF NOT EXISTS metadata (
    -- block --
    block_num                   UInt32,

    -- token metadata --
    contract                    String,
    decimals                    UInt8,
    name                        String,
    symbol                      String,
)
ENGINE = ReplacingMergeTree(block_num)
ORDER BY (
    contract
);

-- Materialized View to keep latest token metadata --
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_metadata TO metadata AS
SELECT
    block_num,
    contract,
    decimals,
    name,
    symbol
FROM metadata_rpc
WHERE is_ok = 1