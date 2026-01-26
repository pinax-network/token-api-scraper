-- Get Solana mints that have a URI but are missing image/description
-- These tokens have on-chain metadata from metadata-solana but need URI content fetched
SELECT
    m.contract as contract,
    m.uri as uri,
    m.name as name,
    m.symbol as symbol,
    m.block_num as block_num,
    m.timestamp as timestamp,
    m.decimals as decimals,
    m.source as source
FROM {db:Identifier}.metadata m
WHERE m.network = {network: String}
  AND m.uri != ''
  AND m.image = ''
  AND m.description = ''
ORDER BY m.timestamp DESC
LIMIT 1000;
