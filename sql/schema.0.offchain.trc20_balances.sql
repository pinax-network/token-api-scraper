-- ============================================================================
-- TRC20 Balances RPC Table
-- Stores TRC20 token balances fetched from smart contracts via RPC calls
-- ============================================================================

CREATE TABLE IF NOT EXISTS trc20_balances_rpc (
    -- Account and contract identifiers
    account String,
    contract String,
    
    -- Balance data in hex format (as returned from RPC)
    balance_hex String DEFAULT '',
    
    -- Block number tracking for continuous queries
    block_num UInt32 DEFAULT 0 COMMENT 'Block number from trc20_transfer that triggered this balance query',
    
    -- Success/error tracking
    is_ok UInt8 DEFAULT if(error = '', 1, 0),
    error String DEFAULT '',
    
    -- Timestamp of last update
    last_update DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(last_update)
ORDER BY (account, contract)
COMMENT 'TRC20 token balances fetched from smart contracts via RPC calls';

-- Indexes for efficient queries
ALTER TABLE trc20_balances_rpc
    ADD INDEX IF NOT EXISTS idx_block_num block_num TYPE minmax GRANULARITY 1,
    ADD INDEX IF NOT EXISTS idx_is_ok is_ok TYPE minmax GRANULARITY 1;

-- Materialized columns for decoded balance
ALTER TABLE trc20_balances_rpc
    ADD COLUMN IF NOT EXISTS balance UInt256 MATERIALIZED if(balance_hex = '', 0, hex_to_uint256(balance_hex)) COMMENT 'Decoded balance value';

-- ============================================================================
-- Native Balances RPC Table  
-- Stores native TRX balances fetched from RPC calls
-- ============================================================================

CREATE TABLE IF NOT EXISTS native_balances_rpc (
    -- Account identifier
    account String,
    
    -- Balance data in hex format (as returned from RPC)
    balance_hex String DEFAULT '',
    
    -- Success/error tracking
    is_ok UInt8 DEFAULT if(error = '', 1, 0),
    error String DEFAULT '',
    
    -- Timestamp of last update
    last_update DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(last_update)
ORDER BY (account)
COMMENT 'Native TRX balances fetched from RPC calls';

-- Indexes for efficient queries
ALTER TABLE native_balances_rpc
    ADD INDEX IF NOT EXISTS idx_is_ok is_ok TYPE minmax GRANULARITY 1;

-- Materialized columns for decoded balance
ALTER TABLE native_balances_rpc
    ADD COLUMN IF NOT EXISTS balance UInt256 MATERIALIZED if(balance_hex = '', 0, hex_to_uint256(balance_hex)) COMMENT 'Decoded balance value';
