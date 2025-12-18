-- Make continuous queries using latest transfers against balances that are not present
-- Use highest block_num as the "last known block" per balance
WITH balances AS (
    SELECT
        contract,
        account,
        block_num
    FROM erc20_balances_rpc
    WHERE is_ok = 1
),
latest_blocks AS (
    SELECT
        contract,
        account,
        MAX(block_num) as last_block_num
    FROM balances
    GROUP BY contract, account
)
SELECT DISTINCT
    t.log_address,
    t.`from`,
    t.`to`,
    t.block_num
FROM erc20_transfer t
LEFT JOIN latest_blocks lb_to ON (t.log_address = lb_to.contract AND t.`to` = lb_to.account)
LEFT JOIN latest_blocks lb_from ON (t.log_address = lb_from.contract AND t.`from` = lb_from.account)
WHERE
    -- Include transfers where 'to' account doesn't have a balance OR has older block_num
    (lb_to.last_block_num IS NULL OR t.block_num > lb_to.last_block_num)
    -- Include transfers where 'from' account doesn't have a balance OR has older block_num
    OR (lb_from.last_block_num IS NULL OR t.block_num > lb_from.last_block_num)
ORDER BY t.block_num DESC
LIMIT 10000;
