WITH processed_conditions AS (
    SELECT condition_id
    FROM polymarket_markets
),
error_conditions AS (
    SELECT condition_id
    FROM polymarket_markets_errors
),
registered_tokens AS (
    SELECT
        condition_id,
        token0,
        token1,
        timestamp
    FROM ctfexchange_token_registered
    ORDER BY timestamp DESC
)
SELECT
    condition_id,
    token0,
    token1
FROM registered_tokens
WHERE condition_id NOT IN processed_conditions
AND condition_id NOT IN error_conditions
ORDER BY timestamp DESC;