SELECT
    contract,
    max(block_num) as block_num,
    max(timestamp) as timestamp
FROM erc20_balances
WHERE contract GLOBAL NOT IN (
    SELECT contract FROM {db:Identifier}.metadata_errors WHERE network = {network: String}
    UNION ALL
    SELECT contract FROM {db:Identifier}.metadata WHERE network = {network: String}
)
GROUP BY contract
ORDER BY timestamp DESC
LIMIT 1000000;
