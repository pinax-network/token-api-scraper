WITH metadata_contracts AS (
    SELECT contract
    FROM `tron:tvm-tokens@v0.1.2`.metadata_rpc
),
contracts AS (
    SELECT DISTINCT input_contract AS contract
    FROM `tron:tvm-dex@v0.1.5`.swaps
    UNION ALL
    SELECT DISTINCT output_contract AS contract
    FROM `tron:tvm-dex@v0.1.5`.swaps
)
SELECT DISTINCT contract
FROM contracts
WHERE contract NOT IN metadata_contracts;