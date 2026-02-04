SELECT
    log_address AS contract,
    max(block_num) as block_num,
    max(timestamp) as timestamp
FROM transfers
LEFT ANTI JOIN (SELECT contract FROM {db:Identifier}.metadata_errors WHERE network = {network: String}) me ON transfers.log_address = me.contract
LEFT ANTI JOIN (SELECT contract FROM {db:Identifier}.metadata WHERE network = {network: String}) m ON transfers.log_address = m.contract
GROUP BY log_address
ORDER BY timestamp DESC
LIMIT 1000000;