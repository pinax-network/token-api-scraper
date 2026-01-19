SELECT
    log_address AS contract,
    max(block_num) as block_num,
    max(timestamp) as timestamp
FROM swaps
WHERE
    contract NOT IN (SELECT contract FROM metadata_errors) AND
    contract NOT IN (SELECT contract FROM metadata)
GROUP BY contract
ORDER BY timestamp DESC
LIMIT 1000000;