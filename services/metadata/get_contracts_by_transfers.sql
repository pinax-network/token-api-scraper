WITH metadata_contracts AS (
    SELECT contract
    FROM metadata

    UNION ALL

    SELECT contract
    FROM metadata_errors
),
contracts AS (
    SELECT
        log_address AS contract,
        max(block_num) as block_num
    FROM transfers
    WHERE transfer_type = 'transfer'
    GROUP BY log_address
)
SELECT *
FROM contracts
WHERE contract NOT IN metadata_contracts
ORDER BY block_num DESC;