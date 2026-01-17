SELECT
    log_address AS contract,
    block_num
FROM erc20_transfers
WHERE
    log_address NOT IN (SELECT contract FROM metadata_errors) AND
    log_address NOT IN (SELECT contract FROM metadata)
LIMIT 10000;
