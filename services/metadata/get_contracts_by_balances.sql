WITH contracts AS (
    SELECT
        contract,
        max(block_num) as block_num,
        max(timestamp) as timestamp
    FROM erc20_balances
    GROUP BY contract
)
SELECT
    c.contract as contract,
    c.block_num as block_num,
    c.timestamp as timestamp
FROM contracts c
ANTI LEFT JOIN (SELECT contract FROM {db:Identifier}.metadata_errors WHERE network = {network: String}) me ON c.contract = me.contract
ANTI LEFT JOIN (SELECT contract FROM {db:Identifier}.metadata WHERE network = {network: String}) m ON c.contract = m.contract
ORDER BY c.timestamp DESC
LIMIT 1000000;
