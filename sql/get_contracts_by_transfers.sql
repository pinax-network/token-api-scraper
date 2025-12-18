WITH metadata_contracts AS (
    SELECT contract
    FROM metadata_rpc
),
contracts AS (
    SELECT log_address AS contract
    FROM erc20_transfer
    GROUP BY log_address
)
SELECT contract
FROM contracts
WHERE contract NOT IN metadata_contracts