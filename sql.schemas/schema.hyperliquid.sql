-- Hyperliquid spot pair names — `@N` → `BASE/QUOTE` lookup.
--
-- Populated by the `hyperliquid` scraper service polling the Hyperliquid Info
-- API (`POST /info {type: spotMeta}`). Each poll writes a full snapshot with a
-- fresh `refresh_time`; ReplacingMergeTree keeps only the latest version per
-- `spot_coin`.
--
-- Token API joins this on `coin = spot_coin` to expose an additive
-- `spot_pair_name` field on routes where spot fills appear.
CREATE TABLE IF NOT EXISTS state_spot_pair_names (
    spot_coin     LowCardinality(String) COMMENT 'value of `coin` on spot fills (e.g. `@107` or `PURR/USDC`)',
    pair_name     LowCardinality(String) COMMENT 'resolved human pair name (e.g. `HYPE/USDC`)',
    refresh_time  DateTime('UTC')        COMMENT 'snapshot time for this row'
)
ENGINE = ReplacingMergeTree(refresh_time)
ORDER BY (spot_coin)
COMMENT 'Hyperliquid spot pair name lookup populated by token-api-scraper';
