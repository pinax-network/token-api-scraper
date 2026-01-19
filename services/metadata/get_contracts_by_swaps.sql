WITH contracts AS (
    SELECT
        log_address AS contract,
        max(block_num) as block_num,
        max(timestamp) as timestamp
    FROM swaps
    WHERE network = {network: String}
    GROUP BY contract
)
SELECT
    contract,
    c.block_num as block_num,
    c.timestamp as timestamp
FROM contracts c
LEFT JOIN (SELECT contract FROM metadata_errors WHERE network = {network: String}) me ON c.contract = me.contract
LEFT JOIN (SELECT contract FROM metadata WHERE network = {network: String}) m ON c.contract = m.contract
WHERE me.contract IS NULL AND m.contract IS NULL
ORDER BY c.timestamp DESC
LIMIT 1000000;