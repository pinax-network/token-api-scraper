WITH metadata_contracts AS (
    SELECT contract
    FROM metadata_rpc
),
transfers AS (
    SELECT
        log_address as contract,
        sum(transactions) as count
    FROM trc20_transfer_agg
    GROUP BY contract
)
SELECT contract, count
FROM transfers
WHERE contract NOT IN metadata_contracts
ORDER BY count DESC;