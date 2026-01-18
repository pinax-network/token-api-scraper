-- Forked Blocks Table
-- Stores blocks that have been detected as forked (block_hash not found in canonical blocks)
-- Uses ReplacingMergeTree to ensure unique block_hash entries
CREATE TABLE IF NOT EXISTS blocks_forked (
    -- block info --
    block_num                   UInt32,
    block_hash                  String,
    parent_hash                 String,
    timestamp                   DateTime('UTC'),

    -- inserter details --
    created_at                  DateTime('UTC') DEFAULT now()
)
ENGINE = ReplacingMergeTree
ORDER BY (
    block_hash
);

-- Refreshable Materialized View for Forked Blocks Detection
-- This is a refreshable MV that periodically detects forked blocks by comparing
-- source blocks against canonical/irreversible blocks from another database.
--
-- NOTE: This MV only needs to be created once to initialize the tables.
-- It will automatically refresh at the specified interval.
--
-- Parameters (must be replaced before execution):
--   - {canonical_database}: The database containing irreversible/canonical blocks
--   - {source_database}: The database containing the source blocks to check
--   - {days_back}: Number of days to look back for forked blocks (default: 30)
--   - {refresh_interval}: Refresh interval in seconds (default: 60)
--
-- Usage:
--   npm run cli setup forked-blocks --canonical-database mainnet:blocks@v0.1.0 --source-database mainnet:evm-transfers@v0.2.1

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_blocks_forked
REFRESH EVERY {refresh_interval:UInt32} SECOND
TO blocks_forked
AS
WITH
    (SELECT max(block_num) FROM {canonical_database:Identifier}.blocks) AS max_block,
    (SELECT min(block_num) FROM {canonical_database:Identifier}.blocks WHERE toDate(timestamp) >= today() - {days_back:UInt32}) AS min_block
SELECT
    b.block_num,
    b.block_hash,
    b.parent_hash,
    b.timestamp,
    now() AS created_at
FROM {source_database:Identifier}.blocks AS b
LEFT ANTI JOIN
(
    SELECT block_hash
    FROM {canonical_database:Identifier}.blocks
    WHERE block_num >= min_block
) AS r USING (block_hash)
WHERE b.block_num BETWEEN min_block AND max_block;

-- Trigger immediate refresh on creation (won't error if view doesn't exist yet)
SYSTEM REFRESH VIEW mv_blocks_forked;
