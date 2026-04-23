-- Prioritize drift candidates (end_date passed but still `closed=false`),
-- then round-robin by `created_at`. Each re-insert bumps `created_at`
-- (DEFAULT now(), also the ReplacingMergeTree version column), so a
-- refreshed drift candidate falls to the tail of its bucket and the next
-- un-refreshed drift candidate rises. Ordering by `end_date` within the
-- bucket was a trap: Polymarket has a long tail of old markets Gamma
-- keeps `closed=false` indefinitely, which monopolized the top of the
-- queue and starved recently-ended markets that were actually resolving.
SELECT
    condition_id,
    toString(token0) AS token0,
    toString(token1) AS token1,
    toString(timestamp) AS timestamp,
    block_hash,
    block_num
FROM {db:Identifier}.polymarket_markets FINAL
WHERE closed = false
ORDER BY
    ifNull(parseDateTime64BestEffortOrNull(end_date) < now(), false) DESC,
    created_at ASC
LIMIT {limit:UInt64};
