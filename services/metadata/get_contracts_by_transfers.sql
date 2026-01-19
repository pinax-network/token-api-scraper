WITH all_transfers AS (
    SELECT
        log_address AS contract,
        max(block_num) as block_num,
        max(timestamp) as timestamp
    FROM transfers
    GROUP BY contract
)
SELECT
    contract,
    t.block_num as block_num,
    t.timestamp as timestamp
FROM all_transfers t
ANTI LEFT JOIN metadata_errors USING (contract)
ANTI LEFT JOIN metadata USING (contract)
ORDER BY t.timestamp DESC
LIMIT 1000000;