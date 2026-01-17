SELECT
    log_address AS contract,
    minute,
    timestamp,
    block_num
FROM transfers
WHERE
    log_address NOT IN (SELECT contract FROM metadata_errors) AND
    log_address NOT IN (SELECT contract FROM metadata)
QUALIFY ROW_NUMBER() OVER (PARTITION BY log_address ORDER BY minute DESC) = 1
ORDER BY minute DESC
LIMIT 10000;
