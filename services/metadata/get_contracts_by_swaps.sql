SELECT
    log_address AS contract,
    max(block_num) as block_num,
    max(timestamp) as timestamp
FROM swaps
WHERE log_address GLOBAL NOT IN (
    SELECT contract FROM {db:Identifier}.metadata_errors WHERE network = {network: String}
    UNION ALL
    SELECT contract FROM {db:Identifier}.metadata WHERE network = {network: String}
)
GROUP BY log_address
ORDER BY timestamp DESC
LIMIT 1000000;