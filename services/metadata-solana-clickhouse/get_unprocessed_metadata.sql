-- Get Solana token metadata from ClickHouse views (mints + metadata)
-- This query combines data from mints_view and metadata_view tables
-- to extract all available metadata fields
SELECT
    m.mint as contract,
    m.program_id as program_id,
    m.block_num as block_num,
    m.timestamp as timestamp,
    m.decimals as decimals,
    coalesce(md.name, '') as name,
    coalesce(md.symbol, '') as symbol,
    coalesce(md.uri, '') as uri
FROM mints_view m
LEFT JOIN metadata_view md ON m.mint = md.mint
ANTI LEFT JOIN (SELECT contract FROM {db:Identifier}.metadata_errors WHERE network = {network: String}) me ON m.mint = me.contract
ANTI LEFT JOIN (SELECT contract FROM {db:Identifier}.metadata WHERE network = {network: String}) meta ON m.mint = meta.contract
ORDER BY m.timestamp DESC
LIMIT 1000;
