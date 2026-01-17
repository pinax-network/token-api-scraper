SELECT
    log_address AS contract,
    max(block_num) as block_num,
    max(timestamp) as timestamp
FROM transfers
WHERE
    log_address NOT IN (SELECT contract FROM metadata_errors) AND
    log_address NOT IN (SELECT contract FROM metadata)
GROUP BY log_address
ORDER BY timestamp DESC
LIMIT 10000;