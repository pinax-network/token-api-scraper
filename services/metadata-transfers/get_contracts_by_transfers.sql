WITH metadata_contracts AS (
    SELECT contract
    FROM metadata_rpc
),
contracts AS (
    SELECT
        log_address AS contract,
        max(block_num) as block_num
    FROM transfers
    GROUP BY log_address
)
SELECT *
FROM contracts
WHERE contract NOT IN metadata_contracts