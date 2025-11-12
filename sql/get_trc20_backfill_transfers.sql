-- Backfill query: Process all transfers from highest block to lowest
-- Skip only accounts that already have balances at the highest block number (already complete)
-- This is different from get_latest_transfers.sql which only gets NEW transfers
WITH max_transfer_block AS (
    SELECT MAX(block_num) as max_block
    FROM trc20_transfer
),
balances_at_max_block AS (
    SELECT 
        contract, 
        account,
        block_num
    FROM trc20_balances_rpc
    WHERE is_ok = 1 
      AND block_num >= (SELECT max_block FROM max_transfer_block)
)
SELECT DISTINCT
    t.log_address,
    t.`from`,
    t.`to`,
    t.block_num
FROM trc20_transfer t
CROSS JOIN max_transfer_block mtb
LEFT JOIN balances_at_max_block b_to ON (t.log_address = b_to.contract AND t.`to` = b_to.account)
LEFT JOIN balances_at_max_block b_from ON (t.log_address = b_from.contract AND t.`from` = b_from.account)
WHERE 
    -- Include 'to' account if it doesn't have a balance at max block
    (b_to.account IS NULL)
    -- Include 'from' account if it doesn't have a balance at max block
    OR (b_from.account IS NULL)
ORDER BY t.block_num DESC
LIMIT 10000;
