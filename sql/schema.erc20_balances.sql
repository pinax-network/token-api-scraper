-- Helper function to format balance with decimals
CREATE OR REPLACE FUNCTION format_balance AS (balance, decimals) ->
(
    if(
        decimals = 0,
        toString(balance),
        concat(
            toString(intDiv(balance, pow(10, decimals))),
            '.',
            leftPad(
                toString(balance % pow(10, decimals)),
                decimals,
                '0'
            )
        )
    )
);

CREATE TABLE IF NOT EXISTS erc20_balances_rpc (
    -- block --
    block_num                   UInt32 DEFAULT 0,
    block_hash                  String DEFAULT '',
    timestamp                   DateTime('UTC') DEFAULT now(),
    minute                      UInt32 DEFAULT toRelativeMinuteNum(timestamp),

    -- balance --
    contract                    LowCardinality(String),
    account                     String,
    balance_hex                 String,
    balance                     UInt256 DEFAULT hex_to_uint256(balance_hex),

    -- error handling --
    created_at                  DateTime('UTC') DEFAULT now(),
    error_msg                   LowCardinality(String) DEFAULT '',
    is_ok                       UInt8 DEFAULT (error_msg = ''), -- 1 if no error, 0 otherwise

    -- INDEXES --
    INDEX idx_balance           (balance) TYPE minmax GRANULARITY 1,

    -- PROJECTIONS --
    -- count() --
    PROJECTION prj_block_hash_count ( SELECT block_hash, count() GROUP BY block_hash ),
    PROJECTION prj_contract_count ( SELECT contract, count() GROUP BY contract ),
    PROJECTION prj_account_count ( SELECT account, count() GROUP BY account ),
    PROJECTION prj_contract_account_count ( SELECT contract, account, count() GROUP BY contract, account )
)
ENGINE = MergeTree
ORDER BY (
    contract, account, block_num
);

-- Latest Balances
CREATE TABLE IF NOT EXISTS erc20_balances (
    -- block --
    block_num                   UInt32,

    -- token balance --
    contract                    String,
    account                     String,
    balance                     UInt256,

    -- INDEX --
    INDEX idx_balance           (balance) TYPE minmax GRANULARITY 1,

    -- PROJECTIONS --
    PROJECTION prj_account_contract ( SELECT * ORDER BY account, contract )
)
ENGINE = ReplacingMergeTree(block_num)
ORDER BY (
    contract, account
)
SETTINGS deduplicate_merge_projection_mode = 'rebuild';

-- Table to keep the latest ERC20 balances per (contract, account) with non-zero balances only --
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_erc20_balances
TO erc20_balances
AS
SELECT
    -- block --
    block_num,
    block_hash,
    timestamp,
    minute,

    -- balance --
    contract,
    account,
    balance
FROM erc20_balances_rpc
WHERE is_ok = 1;

-- Native TRX Balances
CREATE TABLE IF NOT EXISTS native_balances_rpc (
    -- balance --
    account                     String,
    balance_hex                 String,
    balance                     UInt256 DEFAULT hex_to_uint256(balance_hex),

    -- error handling --
    created_at                  DateTime('UTC') DEFAULT now(),
    error_msg                   LowCardinality(String) DEFAULT '',
    is_ok                       UInt8 DEFAULT (error_msg = ''), -- 1 if no error, 0 otherwise

    -- INDEXES --
    INDEX idx_balance           (balance) TYPE minmax GRANULARITY 1
)
ENGINE = MergeTree
ORDER BY (
    account
);
