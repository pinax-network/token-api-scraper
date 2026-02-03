SELECT
    log_address AS contract,
    max(block_num) as block_num,
    max(timestamp) as timestamp
FROM transfers
WHERE NOT EXISTS (
    SELECT 1 FROM {db:Identifier}.metadata_errors WHERE network = {network: String} AND contract = transfers.log_address
)
AND NOT EXISTS (
    SELECT 1 FROM {db:Identifier}.metadata WHERE network = {network: String} AND contract = transfers.log_address
)
GROUP BY log_address
ORDER BY timestamp DESC
LIMIT 1000000;