WITH contracts AS (
    SELECT
        log_address AS contract,
        max(block_num) as block_num,
        max(timestamp) as timestamp
    FROM transfers
    WHERE network = {network: String}
    GROUP BY contract
)
SELECT
    contract,
    c.block_num as block_num,
    c.timestamp as timestamp
FROM contracts c
WHERE
    contract NOT IN (SELECT contract FROM metadata_errors WHERE network = {network: String}) AND
    contract NOT IN (SELECT contract FROM metadata WHERE network = {network: String})
ORDER BY c.timestamp DESC
LIMIT 1000000;