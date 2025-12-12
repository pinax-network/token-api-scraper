SELECT
    token AS contract,
    0 as block_num
FROM state_pools_tokens
WHERE contract NOT IN (
    SELECT DISTINCT contract FROM metadata
    UNION ALL
    SELECT DISTINCT contract FROM metadata_errors
)
GROUP BY token