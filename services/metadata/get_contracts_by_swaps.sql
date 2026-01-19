WITH contracts AS (
    SELECT
        log_address AS contract,
        max(block_num) as block_num,
        max(timestamp) as timestamp
    FROM swaps
    GROUP BY contract
)
SELECT
    c.contract as contract,
    c.block_num as block_num,
    c.timestamp as timestamp
FROM contracts c
ANTI LEFT JOIN (SELECT contract FROM metadata_errors WHERE network = {network: String}) me ON c.contract = me.contract
ANTI LEFT JOIN (SELECT contract FROM metadata WHERE network = {network: String}) m ON c.contract = m.contract
ORDER BY c.timestamp DESC
LIMIT 1000000;