SELECT DISTINCT account
FROM erc20_transfer_agg
WHERE account NOT IN (
    SELECT account
    FROM erc20_balances_rpc
)
LIMIT 1000000