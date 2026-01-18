SELECT
    contract,
    max(block_num) as block_num,
    max(timestamp) as timestamp
FROM balances
WHERE
    contract NOT IN (SELECT contract FROM metadata_errors) AND
    contract NOT IN (SELECT contract FROM metadata)
GROUP BY contract
ORDER BY timestamp DESC
LIMIT 10000;
