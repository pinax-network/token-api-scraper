-- Query to find forked blocks
-- Finds blocks from the source database that are not in the irreversible blocks database
-- Parameters:
--   - {canonical_database:String}: The database containing irreversible/canonical blocks
--   - {source_database:String}: The database containing the source blocks to check
--   - {since_date:String}: Date to start checking from (YYYY-MM-DD format)
WITH
    (SELECT max(block_num) FROM {canonical_database:Identifier}.blocks) AS max_block,
    (SELECT min(block_num) FROM {canonical_database:Identifier}.blocks WHERE toDate(timestamp) >= toDate({since_date:String})) AS min_block
SELECT
    b.block_num,
    b.block_hash,
    b.parent_hash,
    b.timestamp
FROM {source_database:Identifier}.blocks AS b
LEFT ANTI JOIN
(
    SELECT block_hash
    FROM {canonical_database:Identifier}.blocks
    WHERE block_num >= min_block
) AS r USING (block_hash)
PREWHERE b.block_num BETWEEN min_block AND max_block;
