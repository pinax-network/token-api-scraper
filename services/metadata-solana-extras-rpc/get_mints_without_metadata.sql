-- Get Solana mints that have metadata with empty source (no standard metadata found)
-- These are candidates for LP token detection (which requires heavier RPC calls)
SELECT
    m.contract as contract,
    m.block_num as block_num,
    m.timestamp as timestamp,
    m.decimals as decimals
FROM {db:Identifier}.metadata m
WHERE m.network = {network: String}
  AND m.source = ''
  AND m.name = ''
  AND m.symbol = ''
ORDER BY m.timestamp DESC
LIMIT 1000;
