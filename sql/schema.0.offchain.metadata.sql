-- ============================================================================
-- Metadata RPC Table
-- Stores token metadata fetched from smart contracts via RPC calls
-- ============================================================================

CREATE TABLE IF NOT EXISTS metadata_rpc (
    -- Contract address (TRC20 token contract)
    contract String,
    
    -- Token metadata in hex format (as returned from RPC)
    name_hex String DEFAULT '',
    symbol_hex String DEFAULT '',
    decimals_hex String DEFAULT '',
    
    -- Success/error tracking
    is_ok UInt8 DEFAULT if(error = '', 1, 0),
    error String DEFAULT '',
    
    -- Timestamp of last update
    last_update DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(last_update)
ORDER BY (contract)
COMMENT 'Token metadata fetched from smart contracts via RPC calls';

-- Indexes for efficient queries
ALTER TABLE metadata_rpc 
    ADD INDEX IF NOT EXISTS idx_is_ok is_ok TYPE minmax GRANULARITY 1;

-- Materialized columns for decoded values
ALTER TABLE metadata_rpc
    ADD COLUMN IF NOT EXISTS name String MATERIALIZED hex_to_string(name_hex) COMMENT 'Decoded token name',
    ADD COLUMN IF NOT EXISTS symbol String MATERIALIZED hex_to_string(symbol_hex) COMMENT 'Decoded token symbol',
    ADD COLUMN IF NOT EXISTS decimals UInt8 MATERIALIZED if(decimals_hex = '', 0, hex_to_uint256(decimals_hex)) COMMENT 'Token decimals';
