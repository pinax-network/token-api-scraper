SELECT
    log_address AS contract,
    max(block_num) as block_num,
    max(timestamp) as timestamp
FROM swaps
WHERE
    network = {network: String} AND
    contract NOT IN (SELECT contract FROM metadata_errors WHERE network = {network: String}) AND
    contract NOT IN (SELECT contract FROM metadata WHERE network = {network: String})
GROUP BY contract
ORDER BY timestamp DESC
LIMIT 1000000;