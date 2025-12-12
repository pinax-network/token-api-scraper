-- Latest Balances
CREATE TABLE IF NOT EXISTS balances (
    -- block --
    block_num                   UInt32,

    -- token balance --
    contract                    String,
    account                     String,
    balance                     UInt256,

    -- inserter details --
    created_at                  DateTime('UTC') DEFAULT now(),

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
