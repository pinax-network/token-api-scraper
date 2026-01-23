-- Get Solana mints that don't have metadata yet
-- Queries initialize_mint table and excludes mints already in metadata or metadata_errors
SELECT
    im.mint as contract,
    im.block_num as block_num,
    im.timestamp as timestamp,
    im.decimals as decimals
FROM initialize_mint im
ANTI LEFT JOIN (SELECT contract FROM {db:Identifier}.metadata_errors WHERE network = {network: String}) me ON im.mint = me.contract
ANTI LEFT JOIN (SELECT contract FROM {db:Identifier}.metadata WHERE network = {network: String}) m ON im.mint = m.contract
LIMIT 1000;