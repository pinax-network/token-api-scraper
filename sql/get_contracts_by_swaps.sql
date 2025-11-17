WITH metadata_contracts AS (
    SELECT contract
    FROM metadata_rpc
),
contracts AS (
    SELECT DISTINCT input_contract AS contract
    FROM swaps
    UNION ALL
    SELECT DISTINCT output_contract AS contract
    FROM swaps
)
SELECT DISTINCT contract
FROM contracts
WHERE contract NOT IN metadata_contracts;