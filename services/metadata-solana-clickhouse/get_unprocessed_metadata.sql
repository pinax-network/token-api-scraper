-- Get Solana token metadata from ClickHouse views (mints + metadata)
-- This query combines data from initialize_mint and metadata_view tables
-- to extract all available metadata fields
WITH mints AS (
    SELECT mint, decimals, block_num, timestamp, program_id
    FROM {db:Identifier}.initialize_mint as m
    LEFT ANTI JOIN (SELECT contract FROM {db_insert:Identifier}.metadata_errors WHERE network = {network: String}) me ON m.mint = me.contract
    LEFT ANTI JOIN (SELECT contract FROM {db_insert:Identifier}.metadata WHERE network = {network: String}) meta ON m.mint = meta.contract
    WHERE decimals != 0
    LIMIT 500000
),
metadata AS (
    SELECT mint, decimals, block_num, timestamp, program_id, ms.metadata as metadata
    FROM mints m
    LEFT JOIN {db:Identifier}.metadata_mint_state as ms ON m.mint = ms.mint
)
SELECT
    m.mint as contract,
    m.block_num as block_num,
    m.timestamp as timestamp,
    m.decimals as decimals,
    m.metadata as metadata,
    m.program_id as program_id,
    coalesce(m_name.name, '') as name,
    coalesce(m_symbol.symbol, '') as symbol,
    coalesce(m_uri.uri, '') as uri
FROM metadata m
LEFT JOIN {db:Identifier}.metadata_uri_state as m_uri USING (metadata)
LEFT JOIN {db:Identifier}.metadata_name_state as m_name USING (metadata)
LEFT JOIN {db:Identifier}.metadata_symbol_state as m_symbol USING (metadata)