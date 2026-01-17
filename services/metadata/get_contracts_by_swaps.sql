SELECT
    log_address AS contract,
    timestamp,
    block_num
FROM swaps
ORDER BY minute DESC
LIMIT 10000;
