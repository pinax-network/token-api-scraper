-- Prioritize drift candidates (end_date passed but still `closed=false`),
-- then nearest-to-resolve, then round-robin by `created_at`. Each re-insert
-- bumps `created_at` (DEFAULT now(), also the ReplacingMergeTree version
-- column), so refreshed rows naturally fall to the tail of the queue.
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
    (parseDateTime64BestEffortOrNull(end_date) < now()) DESC,
    parseDateTime64BestEffortOrNull(end_date) ASC NULLS LAST,
    created_at ASC
LIMIT {limit:UInt64};
