WITH excluded_contracts AS (
    SELECT contract FROM {db:Identifier}.metadata_errors WHERE network = {network: String}
    UNION DISTINCT
    SELECT contract FROM {db:Identifier}.metadata WHERE network = {network: String}
),
contracts AS (
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
WHERE c.contract NOT IN excluded_contracts
ORDER BY c.timestamp DESC
LIMIT 1000000;
