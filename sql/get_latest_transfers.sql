-- don't include contract/account that already exists in `trc20_balances_rpc`
WITH balances AS (
    SELECT DISTINCT contract, account
    FROM trc20_balances_rpc
)
SELECT DISTINCT
    log_address, `from`, `to`
FROM trc20_transfer
WHERE (log_address, `to`) NOT IN balances
ORDER BY timestamp DESC
LIMIT 10000;
