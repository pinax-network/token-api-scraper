WITH metadata_contracts AS (
    SELECT contract
    FROM metadata

    UNION ALL

    SELECT contract
    FROM metadata_errors
),
contracts AS (
    SELECT token AS contract, 0 as block_num
    FROM state_pools_tokens
    GROUP BY token
)
SELECT *
FROM contracts
WHERE contract NOT IN metadata_contracts