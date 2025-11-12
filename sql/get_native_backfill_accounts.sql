-- Backfill query: Get all distinct accounts from transfers, ordered by highest block first
-- Skip accounts that already have native balances
-- This processes backwards from end of chain to beginning
WITH max_block AS (
    SELECT MAX(block_num) as max_block_num
    FROM erc20_transfer
),
native_balances AS (
    SELECT DISTINCT account
    FROM native_balances_rpc
),
accounts_with_blocks AS (
    SELECT DISTINCT 
        account,
        MAX(block_num) as last_seen_block
    FROM erc20_transfer_agg
    GROUP BY account
)
SELECT 
    a.account,
    a.last_seen_block
FROM accounts_with_blocks a
WHERE a.account NOT IN native_balances
ORDER BY a.last_seen_block DESC
LIMIT 10000;
