
-- Function to decode hex string to UTF-8 string
-- Used for decoding token name and symbol from smart contract responses
CREATE OR REPLACE FUNCTION hex_to_string AS (hex_str) -> if(
    hex_str = '' OR hex_str IS NULL,
    '',
    unhex(replaceRegexpAll(hex_str, '^0x', ''))
);

-- Function to safely convert hex to decimal (UInt256)
-- Used for decoding balance and decimals values
CREATE OR REPLACE FUNCTION hex_to_uint256 AS (hex_str) -> if(
    hex_str = '' OR hex_str IS NULL,
    0,
    reinterpretAsUInt256(reverse(unhex(replaceRegexpAll(hex_str, '^0x', ''))))
);

-- Raw Token Metadata from RPC
CREATE TABLE IF NOT EXISTS metadata_rpc (
    -- block --
    block_num                   UInt32 DEFAULT 0,
    block_hash                  String DEFAULT '',
    timestamp                   DateTime('UTC') DEFAULT now(),
    minute                      UInt32 DEFAULT toRelativeMinuteNum(timestamp),

    -- token metadata --
    contract                    String,
    decimals_hex                String,
    name_hex                    String,
    symbol_hex                  String,
    decimals                    UInt8 MATERIALIZED abi_hex_to_uint8(decimals_hex),
    name                        String MATERIALIZED abi_hex_to_string(name_hex),
    symbol                      String MATERIALIZED abi_hex_to_string(symbol_hex),

    -- error handling --
    created_at                  DateTime('UTC') DEFAULT now(),
    error_msg                   String DEFAULT '',
    is_ok                       UInt8 DEFAULT (error_msg = ''), -- 1 if no error, 0 otherwise

    -- PROJECTIONS --
    -- count() --
    PROJECTION prj_block_hash_count ( SELECT block_hash, count() GROUP BY block_hash ),
    PROJECTION prj_contract_count ( SELECT contract, count() GROUP BY contract ),
)
ENGINE = MergeTree
ORDER BY (
    contract, block_num,
);

-- Token Metadata
CREATE TABLE IF NOT EXISTS metadata (
    -- block --
    block_num                   UInt32,
    block_hash                  String,
    timestamp                   DateTime('UTC'),
    minute                      UInt32,

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

-- VIEW for easier querying
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_metadata
TO metadata
AS
SELECT
    -- block --
    block_num,
    block_hash,
    timestamp,
    minute,

    -- token metadata --
    contract,
    decimals,
    name,
    symbol
FROM metadata_rpc
WHERE is_ok = 1;

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