SELECT
    contract,
    max(block_num) as block_num,
    max(timestamp) as timestamp
FROM erc20_balances
WHERE NOT EXISTS (
    SELECT 1 FROM {db:Identifier}.metadata_errors WHERE network = {network: String} AND metadata_errors.contract = erc20_balances.contract
)
AND NOT EXISTS (
    SELECT 1 FROM {db:Identifier}.metadata WHERE network = {network: String} AND metadata.contract = erc20_balances.contract
)
GROUP BY contract
ORDER BY timestamp DESC
LIMIT 1000000;
