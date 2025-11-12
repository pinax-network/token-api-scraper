-- Database Schema Requirements for Continuous Queries
-- This file documents the required schema changes for erc20_balances_rpc table

-- Add block_num column to track the block number of the transfer that triggered the balance query
-- This enables continuous/incremental queries by tracking the last processed block per balance

ALTER TABLE erc20_balances_rpc
    ADD COLUMN IF NOT EXISTS block_num UInt32 DEFAULT 0 COMMENT 'Block number from erc20_transfer that triggered this balance query',
    ADD INDEX IF NOT EXISTS idx_block_num (block_num) TYPE minmax GRANULARITY 1;

-- Note: The existing schema already includes:
-- - contract and account columns for tracking balances
-- - is_ok column for filtering successful queries
-- - balance_hex and balance columns for storing the actual balance
-- - error column for tracking failed queries
-- - last_update column for tracking when the balance was queried
-- - ReplacingMergeTree engine for deduplication based on (account, contract)

-- The block_num addition enables:
-- 1. Tracking which transfers have been processed
-- 2. Querying only newer transfers on subsequent runs
-- 3. Avoiding redundant RPC calls for already-processed transfers
-- 4. Maintaining an audit trail of block numbers

-- Query to verify the schema is correct:
-- DESCRIBE TABLE erc20_balances_rpc;

-- Query to check block_num distribution:
-- SELECT 
--     MIN(block_num) as min_block,
--     MAX(block_num) as max_block,
--     COUNT(*) as total_balances,
--     COUNT(DISTINCT block_num) as unique_blocks
-- FROM erc20_balances_rpc
-- WHERE is_ok = 1;

-- Query to see how many balances need updating:
-- WITH latest_blocks AS (
--     SELECT contract, account, MAX(block_num) as last_block_num
--     FROM erc20_balances_rpc
--     WHERE is_ok = 1
--     GROUP BY contract, account
-- )
-- SELECT COUNT(*) as transfers_to_process
-- FROM erc20_transfer t
-- LEFT JOIN latest_blocks lb ON (t.log_address = lb.contract AND t.to = lb.account)
-- WHERE lb.last_block_num IS NULL OR t.block_num > lb.last_block_num
-- LIMIT 10000;
