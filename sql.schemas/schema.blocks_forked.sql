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
    created_at                  DateTime('UTC') DEFAULT now(),
)
ENGINE = ReplacingMergeTree
ORDER BY (
    block_hash
);
