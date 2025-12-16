SELECT
    token as contract,
    max(max_block_num) AS block_num
FROM state_pools_aggregating_by_token
WHERE contract NOT IN (
    SELECT DISTINCT contract FROM metadata
    UNION ALL
    SELECT DISTINCT contract FROM metadata_errors
)
GROUP BY token
ORDER BY block_num DESC;