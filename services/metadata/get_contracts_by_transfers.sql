WITH contracts AS (
    SELECT
        log_address AS contract,
        max(block_num) as block_num,
        max(timestamp) as timestamp
    FROM transfers
    GROUP BY contract
)
SELECT
    contract,
    c.block_num as block_num,
    c.timestamp as timestamp
FROM contracts c
ANTI LEFT JOIN metadata_errors USING (contract)
ANTI LEFT JOIN metadata USING (contract)
ORDER BY c.timestamp DESC
LIMIT 1000000;