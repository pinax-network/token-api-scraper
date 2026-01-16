WITH processed_conditions AS (
    SELECT condition_id
    FROM polymarket_markets
),
error_conditions AS (
    SELECT condition_id
    FROM polymarket_markets_errors
)
SELECT
    condition_id,
    toString(token0) as token0,
    toString(token1) as token1,
    timestamp
FROM ctfexchange_token_registered
WHERE
    condition_id NOT IN processed_conditions AND
    condition_id NOT IN error_conditions
ORDER BY timestamp DESC
LIMIT 10000;