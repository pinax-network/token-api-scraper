-- Get distinct accounts that don't have native balances yet
-- Uses SQL optimization similar to get_latest_transfers.sql
WITH native_balances AS (
    SELECT DISTINCT account
    FROM native_balances_rpc
)
SELECT DISTINCT account
FROM trc20_transfer_agg
WHERE account NOT IN native_balances
ORDER BY account
LIMIT 10000;
