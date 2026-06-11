-- Hyperliquid outcome (HIP-4) metadata — outcome + question lookups.
--
-- Populated by the `hyperliquid-outcomes` scraper service polling the
-- Hyperliquid Info API:
--   * `POST /info {type: outcomeMeta}`            → currently-live outcomes + questions
--   * `POST /info {type: settledOutcome, outcome: N}` → settled outcomes (per-id recovery)
--
-- `outcomeMeta` only returns currently-active outcomes; settled outcomes drop
-- out of the response. The scraper discovers unknown ids by reading
-- `outcome_fills.outcome_id` (substreams-written) and probes `settledOutcome`
-- for any not in the live snapshot. ReplacingMergeTree on `refresh_time`
-- collapses repeated upserts of the same id.
--
-- Token API joins these tables on `outcome_id` / `question_id` to expose
-- human-readable labels on the `/v1/hyperliquid/outcomes/*` family.
CREATE TABLE IF NOT EXISTS state_outcome_meta (
    outcome_id      UInt64                          COMMENT 'matches outcome_fills.outcome_id',
    question_id     Nullable(UInt64)                COMMENT 'parent question if grouped via questions[].namedOutcomes or fallbackOutcome; NULL for standalone outcomes',
    name            String                          COMMENT 'human-readable outcome name (e.g. "June Fed rate change") or "Recurring" for daily price binaries',
    description     String                          COMMENT 'full resolution description; for "Recurring" outcomes encodes class:|underlying:|expiry:|targetPrice:|period: spec — kept raw, parsed at query time',
    side_specs      Array(String)                   COMMENT 'positional side labels; outcome_fills.side_index indexes directly into this array (typically [Yes, No] or domain-specific labels)',
    quote_token     LowCardinality(String)          COMMENT 'settlement token symbol (USDC, USDH, ...)',
    status          LowCardinality(String)          COMMENT 'live | settled — live = present in current outcomeMeta; settled = recovered via settledOutcome',
    settle_fraction Nullable(Float64)               COMMENT 'NULL for live; 0.0/1.0/scalar for settled (resolution payout fraction per share)',
    settle_details  Nullable(String)                COMMENT 'NULL for live; raw HL details string for settled (e.g. "price:78212.4")',
    refresh_time    DateTime64(3, 'UTC')            COMMENT 'snapshot time for this row (ms precision so closely-spaced polls remain deterministic for ReplacingMergeTree merges)'
)
ENGINE = ReplacingMergeTree(refresh_time)
ORDER BY (outcome_id)
COMMENT 'Hyperliquid HIP-4 outcome metadata populated by token-api-scraper';

CREATE TABLE IF NOT EXISTS state_question_meta (
    question_id          UInt64                          COMMENT 'matches questions[].question on outcomeMeta',
    name                 String                          COMMENT 'human-readable question name (e.g. "2026 World Cup Champion")',
    description          String                          COMMENT 'full resolution description; kept raw',
    fallback_outcome_id  Nullable(UInt64)                COMMENT 'questions[].fallbackOutcome — outcome id used when none of the named outcomes resolve YES',
    named_outcome_ids    Array(UInt64)                   COMMENT 'questions[].namedOutcomes — outcome ids that compose this question',
    settled_outcome_ids  Array(UInt64)                   COMMENT 'questions[].settledNamedOutcomes — subset of named_outcome_ids that have already resolved',
    refresh_time         DateTime64(3, 'UTC')            COMMENT 'snapshot time for this row (ms precision so closely-spaced polls remain deterministic for ReplacingMergeTree merges)'
)
ENGINE = ReplacingMergeTree(refresh_time)
ORDER BY (question_id)
COMMENT 'Hyperliquid HIP-4 question grouping populated by token-api-scraper';
