-- Rotate through currently-open markets by oldest `created_at`. Each
-- re-insert bumps `created_at` (DEFAULT now(), also the ReplacingMergeTree
-- version column), so refreshed rows naturally fall to the tail of the
-- queue and the scraper round-robins through the open-market set.
SELECT
    condition_id,
    toString(token0) AS token0,
    toString(token1) AS token1,
    toString(timestamp) AS timestamp,
    block_hash,
    block_num
FROM {db:Identifier}.polymarket_markets FINAL
WHERE closed = false
ORDER BY created_at ASC
LIMIT {limit:UInt64};
