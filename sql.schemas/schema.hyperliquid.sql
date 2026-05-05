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
    coin          LowCardinality(String) COMMENT 'matches `coin` on spot fills (e.g. `@107` or `PURR/USDC`)',
    market_name   LowCardinality(String) COMMENT 'resolved human market name (e.g. `HYPE/USDC`)',
    base_token    LowCardinality(String) COMMENT 'base token symbol (e.g. `HYPE`)',
    quote_token   LowCardinality(String) COMMENT 'quote token symbol (e.g. `USDC`)',
    refresh_time  DateTime64(3, 'UTC')   COMMENT 'snapshot time for this row (ms precision so closely-spaced polls remain deterministic for ReplacingMergeTree merges)'
)
ENGINE = ReplacingMergeTree(refresh_time)
ORDER BY (coin)
COMMENT 'Hyperliquid spot pair name lookup populated by token-api-scraper';
