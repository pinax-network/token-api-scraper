WITH metadata_contracts AS (
    SELECT contract
    FROM `tron:tvm-tokens@v0.1.2`.metadata_rpc
),
contracts AS (
    SELECT log_address AS contract
    FROM `tron:tvm-tokens@v0.1.2`.erc20_transfer
    GROUP BY log_address
)
SELECT contract
FROM contracts
WHERE contract NOT IN metadata_contracts