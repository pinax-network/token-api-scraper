-- Get Solana mints that don't have metadata yet
-- Queries initialize_mint table and excludes mints already in metadata or metadata_errors
SELECT DISTINCT
    im.mint as mint,
    im.decimals as decimals,
    im.block_num as block_num,
    toUnixTimestamp(im.block_time) as timestamp
FROM initialize_mint im
LEFT JOIN {db:Identifier}.metadata m
    ON m.network = {network:String}
    AND m.contract = im.mint
LEFT JOIN {db:Identifier}.metadata_errors me
    ON me.network = {network:String}
    AND me.contract = im.mint
WHERE m.contract IS NULL
    AND me.contract IS NULL
ORDER BY im.block_num ASC
LIMIT 10000
