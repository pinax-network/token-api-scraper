WITH metadata_contracts AS (
    SELECT contract, block_num
    FROM metadata_rpc
),
contracts AS (
    SELECT
        log_address AS contract,
        max(block_num) as block_num
    FROM trc20_transfer
    GROUP BY log_address
)
SELECT *
FROM contracts
WHERE (contract, block_num) NOT IN metadata_contracts