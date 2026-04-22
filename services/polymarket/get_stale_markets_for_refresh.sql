-- Rotate through currently-open markets by oldest Gamma-reported updated_at_api.
-- Re-inserting with a fresh ReplacingMergeTree `created_at` lets FINAL serve
-- the refreshed row; ordering by `updated_at_api ASC` means each cycle picks
-- up the markets we've seen the freshest data for longest ago, giving round-
-- robin coverage over time.
SELECT
    condition_id,
    toString(token0) AS token0,
    toString(token1) AS token1,
    toString(timestamp) AS timestamp,
    block_hash,
    block_num
FROM {db:Identifier}.polymarket_markets FINAL
WHERE closed = false
ORDER BY parseDateTime64BestEffortOrNull(updated_at_api) ASC NULLS FIRST
LIMIT {limit:UInt64};
