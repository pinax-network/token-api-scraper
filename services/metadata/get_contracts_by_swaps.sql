WITH metadata_contracts AS (
    SELECT contract
    FROM metadata_rpc
),
contracts AS (
    SELECT input_contract AS contract, max(s.block_num) AS block_num
    FROM `tron:tvm-dex@v0.1.5`.swaps s
    GROUP BY input_contract

    UNION ALL

    SELECT output_contract AS contract, max(s.block_num) AS block_num
    FROM `tron:tvm-dex@v0.1.5`.swaps s
    GROUP BY output_contract
)
SELECT contract, max(c.block_num) AS block_num
FROM contracts as c
WHERE contract NOT IN metadata_contracts
GROUP BY contract