SELECT
    condition_id,
    toString(t.token0) AS token0,
    toString(t.token1) AS token1,
    t.block_num AS block_num,
    t.block_hash AS block_hash,
    t.timestamp AS timestamp
FROM ctfexchange_token_registered t
ANTI LEFT JOIN {db:Identifier}.polymarket_markets_errors USING (condition_id)
ANTI LEFT JOIN {db:Identifier}.polymarket_markets USING (condition_id)
ORDER BY t.timestamp DESC
LIMIT 10000;