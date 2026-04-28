import { sleep } from 'bun';
import PQueue from 'p-queue';
import {
    getBatchInsertQueue,
    shutdownBatchInsertQueue,
} from '../../lib/batch-insert';
import { query } from '../../lib/clickhouse';
import { CLICKHOUSE_DATABASE_INSERT, CONCURRENCY } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { ProcessingStats } from '../../lib/processing-stats';
import { incrementError, incrementSuccess } from '../../lib/prometheus';
import { initService } from '../../lib/service-init';
import { insertRow } from '../../src/insert';
import {
    fetchEventFromApi,
    fetchMarketFromApi,
    fetchMarketsFromApi,
    type PolymarketEvent,
    type PolymarketMarket,
    type PolymarketSeries,
} from './gamma';

/**
 * Delay between requests in milliseconds to avoid overwhelming the API.
 * Configurable via POLYMARKET_REQUEST_DELAY_MS. Default raised from 100ms
 * to 250ms to reduce 429 pressure under Gamma's per-IP rate limits.
 */
const REQUEST_DELAY_MS = parseInt(
    process.env.POLYMARKET_REQUEST_DELAY_MS || '250',
    10,
);

/**
 * Refresh pass: number of currently-open markets to re-scrape each cycle so
 * mutable Gamma fields (closed, accepting_orders, volume, ...) don't drift
 * after initial ingestion. Set to 0 to disable the pass (e.g. for backfills).
 */
const REFRESH_BATCH_SIZE = parseInt(
    process.env.POLYMARKET_REFRESH_BATCH_SIZE || '1000',
    10,
);

const serviceName = 'polymarket';
const log = createLogger(serviceName);

/**
 * Normalize a Gamma ISO 8601 timestamp so it fits ClickHouse
 * `DateTime('UTC')` columns. CH's DateTime parser accepts
 * `YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DDTHH:MM:SS` but rejects fractional
 * seconds and the trailing `Z` / `±HH:MM` offset Gamma tacks on, so strip
 * both. A caller that feeds chain-sourced "YYYY-MM-DD HH:MM:SS" already
 * matches the accepted shape and passes through unchanged.
 */
export function normalizeGammaTimestamp(s: string | undefined | null): string {
    if (!s) return '1970-01-01T00:00:00';
    return s.replace(/\.\d+/, '').replace(/(Z|[+-]\d{2}:?\d{2})$/, '');
}

/**
 * Parse a JSON array string into a string array
 * Returns an empty array if parsing fails
 */
function parseJsonArray(jsonStr: string | undefined | null): string[] {
    if (!jsonStr) return [];
    try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
            return parsed.map((item) => String(item));
        }
        return [];
    } catch {
        return [];
    }
}

/**
 * Interface for the registered token data from the database
 */
interface RegisteredToken {
    condition_id: string;
    token0: string;
    token1: string;
    timestamp: string;
    block_hash: string;
    block_num: number;
}

/**
 * Insert market data into the polymarket_markets table
 */
async function insertMarket(
    market: PolymarketMarket,
    token0: string,
    token1: string,
    timestamp: string,
    block_hash: string,
    block_num: number,
): Promise<boolean> {
    const row = {
        condition_id: market.conditionId || '',
        token0,
        token1,
        timestamp: normalizeGammaTimestamp(timestamp),
        block_hash,
        block_num,
        market_id: market.id || '',
        question: market.question || '',
        description: market.description || '',
        market_slug: market.slug || '',
        outcomes: parseJsonArray(market.outcomes),
        resolution_source: market.resolutionSource || '',
        image: market.image || '',
        icon: market.icon || '',
        question_id: market.questionID || '',
        clob_token_ids: parseJsonArray(market.clobTokenIds),
        outcome_prices: parseJsonArray(market.outcomePrices),
        submitted_by: market.submitted_by || '',
        market_maker_address: market.marketMakerAddress || '',
        enable_order_book: market.enableOrderBook || false,
        order_price_min_tick_size: market.orderPriceMinTickSize || 0,
        order_min_size: market.orderMinSize || 0,
        neg_risk: market.negRisk || false,
        neg_risk_request_id: market.negRiskRequestID || '',
        neg_risk_other: market.negRiskOther || false,
        archived: market.archived || false,
        new: market.new || false,
        featured: market.featured || false,
        resolved_by: market.resolvedBy || '',
        restricted: market.restricted || false,
        has_reviewed_dates: market.hasReviewedDates || false,
        uma_bond: market.umaBond || '',
        uma_reward: market.umaReward || '',
        custom_liveness: market.customLiveness || 0,
        accepting_orders: market.acceptingOrders || false,
        ready: market.ready || false,
        funded: market.funded || false,
        accepting_orders_timestamp: market.acceptingOrdersTimestamp || '',
        cyom: market.cyom || false,
        competitive: market.competitive || 0,
        pager_duty_notification_enabled:
            market.pagerDutyNotificationEnabled || false,
        approved: market.approved || false,
        rewards_min_size: market.rewardsMinSize || 0,
        rewards_max_spread: market.rewardsMaxSpread || 0,
        spread: market.spread || 0,
        automatically_active: market.automaticallyActive || false,
        clear_book_on_start: market.clearBookOnStart || false,
        manual_activation: market.manualActivation || false,
        pending_deployment: market.pendingDeployment || false,
        deploying: market.deploying || false,
        deploying_timestamp: market.deployingTimestamp || '',
        rfq_enabled: market.rfqEnabled || false,
        event_start_time: market.eventStartTime || '',
        holding_rewards_enabled: market.holdingRewardsEnabled || false,
        fees_enabled: market.feesEnabled || false,
        requires_translation: market.requiresTranslation || false,
        // Volume and liquidity fields
        liquidity: market.liquidity || '',
        volume: market.volume || '',
        volume_num: market.volumeNum || 0,
        liquidity_num: market.liquidityNum || 0,
        volume_24hr: market.volume24hr || 0,
        volume_1wk: market.volume1wk || 0,
        volume_1mo: market.volume1mo || 0,
        volume_1yr: market.volume1yr || 0,
        volume_24hr_clob: market.volume24hrClob || 0,
        volume_1wk_clob: market.volume1wkClob || 0,
        volume_1mo_clob: market.volume1moClob || 0,
        volume_1yr_clob: market.volume1yrClob || 0,
        volume_clob: market.volumeClob || 0,
        liquidity_clob: market.liquidityClob || 0,
        // Market status
        active: market.active || false,
        closed: market.closed || false,
        // Pricing
        one_day_price_change: market.oneDayPriceChange || 0,
        one_hour_price_change: market.oneHourPriceChange || 0,
        last_trade_price: market.lastTradePrice || 0,
        best_bid: market.bestBid || 0,
        best_ask: market.bestAsk || 0,
        // UMA
        uma_resolution_statuses: market.umaResolutionStatuses || '',
        // Dates
        start_date: market.startDate || '',
        end_date: market.endDate || '',
        start_date_iso: market.startDateIso || '',
        end_date_iso: market.endDateIso || '',
        uma_end_date: market.umaEndDate || '',
        created_at_api: market.createdAt || '',
        updated_at_api: market.updatedAt || '',
    };

    return await insertRow(
        'polymarket_markets',
        row,
        `Failed to insert market for condition_id ${market.conditionId}`,
        {},
    );
}

/**
 * Insert error record into the polymarket_markets_errors table
 */
async function insertError(
    condition_id: string,
    token0: string,
    token1: string,
    error: string,
): Promise<boolean> {
    return await insertRow(
        'polymarket_markets_errors',
        {
            condition_id,
            token0,
            token1,
            error,
        },
        `Failed to insert error for condition_id ${condition_id}`,
        {},
    );
}

/**
 * Insert event data into the polymarket_events table
 */
async function insertEvent(
    event: PolymarketEvent,
    condition_id: string,
): Promise<boolean> {
    const row = {
        condition_id,
        event_id: event.id || '',
        ticker: event.ticker || '',
        slug: event.slug || '',
        title: event.title || '',
        description: event.description || '',
        resolution_source: event.resolutionSource || '',
        image: event.image || '',
        icon: event.icon || '',
        active: event.active || false,
        closed: event.closed || false,
        archived: event.archived || false,
        new: event.new || false,
        featured: event.featured || false,
        restricted: event.restricted || false,
        enable_order_book: event.enableOrderBook || false,
        neg_risk: event.negRisk || false,
        cyom: event.cyom || false,
        show_all_outcomes: event.showAllOutcomes || false,
        show_market_images: event.showMarketImages || false,
        enable_neg_risk: event.enableNegRisk || false,
        automatically_active: event.automaticallyActive || false,
        neg_risk_augmented: event.negRiskAugmented || false,
        pending_deployment: event.pendingDeployment || false,
        deploying: event.deploying || false,
        requires_translation: event.requiresTranslation || false,
        liquidity: event.liquidity || 0,
        volume: event.volume || 0,
        open_interest: event.openInterest || 0,
        competitive: event.competitive || 0,
        volume_24hr: event.volume24hr || 0,
        volume_1wk: event.volume1wk || 0,
        volume_1mo: event.volume1mo || 0,
        volume_1yr: event.volume1yr || 0,
        liquidity_clob: event.liquidityClob || 0,
        comment_count: Math.max(0, event.commentCount || 0),
        series_slug: event.seriesSlug || '',
        start_date: event.startDate || '',
        creation_date: event.creationDate || '',
        end_date: event.endDate || '',
        created_at_api: event.createdAt || '',
        updated_at_api: event.updatedAt || '',
    };

    return await insertRow(
        'polymarket_events',
        row,
        `Failed to insert event ${event.id} for condition_id ${condition_id}`,
        {},
    );
}

/**
 * Insert series data into the polymarket_series table
 */
async function insertSeries(
    series: PolymarketSeries,
    condition_id: string,
    event_id: string,
): Promise<boolean> {
    const row = {
        condition_id,
        event_id,
        series_id: series.id || '',
        ticker: series.ticker || '',
        slug: series.slug || '',
        title: series.title || '',
        series_type: series.seriesType || '',
        recurrence: series.recurrence || '',
        image: series.image || '',
        icon: series.icon || '',
        active: series.active || false,
        closed: series.closed || false,
        archived: series.archived || false,
        featured: series.featured || false,
        restricted: series.restricted || false,
        requires_translation: series.requiresTranslation || false,
        volume: series.volume || 0,
        liquidity: series.liquidity || 0,
        comment_count: Math.max(0, series.commentCount || 0),
        created_at_api: series.createdAt || '',
        updated_at_api: series.updatedAt || '',
    };

    return await insertRow(
        'polymarket_series',
        row,
        `Failed to insert series ${series.id} for event ${event_id}`,
        {},
    );
}

/**
 * Insert events and series data for a market
 */
async function insertEventsAndSeries(
    market: PolymarketMarket,
    condition_id: string,
): Promise<void> {
    if (!market.events || !Array.isArray(market.events)) {
        return;
    }

    for (const event of market.events) {
        const eventSuccess = await insertEvent(event, condition_id);
        if (!eventSuccess) {
            log.warn('Failed to insert event', {
                conditionId: condition_id,
                eventId: event.id,
            });
            // Continue to next event, don't insert series for failed event
            continue;
        }

        // Insert series for each event
        if (event.series && Array.isArray(event.series)) {
            for (const series of event.series) {
                const seriesSuccess = await insertSeries(
                    series,
                    condition_id,
                    event.id,
                );
                if (!seriesSuccess) {
                    log.warn('Failed to insert series', {
                        conditionId: condition_id,
                        eventId: event.id,
                        seriesId: series.id,
                    });
                }
            }
        }
    }
}

/**
 * Process a single registered token
 * Fetches market data for the token and inserts into tables
 */
interface ProcessTokenOptions {
    /** Record "market not found" rows in `polymarket_markets_errors`.
     * Main/enrichment passes want this (drives the 24h error-retry gate);
     * the refresh pass already has the condition_id in our mirror, so
     * a transient Gamma miss shouldn't pollute the errors table. */
    recordErrors?: boolean;
}

async function processToken(
    token: RegisteredToken,
    stats: ProcessingStats,
    options: ProcessTokenOptions = {},
): Promise<void> {
    const { recordErrors = true } = options;
    const { condition_id, token0, token1, timestamp, block_hash, block_num } =
        token;
    const startTime = performance.now();

    const market = await fetchMarketFromApi(condition_id);

    const queryTimeMs = Math.round(performance.now() - startTime);

    log.debug('API request completed', {
        conditionId: condition_id,
        found: !!market,
        queryTimeMs,
    });

    if (!market) {
        log.warn('No market found for condition_id', {
            conditionId: condition_id,
        });
        if (recordErrors) {
            await insertError(condition_id, token0, token1, 'Market not found');
        }
        incrementError(serviceName);
        stats.incrementError();
        return;
    }

    // Insert market data
    const marketSuccess = await insertMarket(
        market,
        token0,
        token1,
        timestamp,
        block_hash,
        block_num,
    );

    if (marketSuccess) {
        log.debug('Market data scraped successfully', {
            conditionId: condition_id,
            question: (market.question || '').substring(0, 50),
        });
        incrementSuccess(serviceName);
        stats.incrementSuccess();

        // Insert events and series data
        await insertEventsAndSeries(market, condition_id);
    } else {
        log.warn('Insert failure', {
            conditionId: condition_id,
        });
        incrementError(serviceName);
        stats.incrementError();
    }

    // Add delay between requests to avoid overwhelming the API
    await sleep(REQUEST_DELAY_MS);
}

/**
 * Main run function for the polymarket service
 */
export async function run(): Promise<void> {
    // Initialize service (must be called before using batch insert queue)
    initService({ serviceName });

    // Track processing stats for summary logging
    const stats = new ProcessingStats(serviceName, 'polygon');

    const queue = new PQueue({ concurrency: CONCURRENCY });

    // Query for unprocessed condition_ids
    log.info('Querying database for unprocessed condition_ids');
    const tokens = await query<RegisteredToken>(
        await Bun.file(__dirname + '/get_unprocessed_condition_ids.sql').text(),
        {
            db: CLICKHOUSE_DATABASE_INSERT,
        },
    );

    if (tokens.data.length > 0) {
        log.info('Processing Polymarket markets', {
            conditionCount: tokens.data.length,
            source: 'ctfexchange_token_registered',
        });

        // Start progress logging (logs every 10 seconds)
        stats.startProgressLogging(tokens.data.length);
    } else {
        log.info('No new condition_ids to process');
    }

    if (tokens.data.length > 0) {
        // Process each token individually
        for (const token of tokens.data) {
            queue.add(async () => {
                await processToken(token, stats);
            });
        }

        // Wait for all tasks to complete
        await queue.onIdle();

        stats.logCompletion();
    }

    await flushPass('main');
    await enrichEvents();
    await flushPass('enrichment');
    await refreshOpenMarkets();
    await flushPass('refresh');

    // Shutdown batch insert queue
    await shutdownBatchInsertQueue();
}

type PassName = 'main' | 'enrichment' | 'refresh';

/**
 * Drain the shared batch queue between passes and warn loudly if CH rejected
 * any rows. Keeps per-pass error attribution clean and catches silent CH-side
 * rejections before the next pass piles more rows on.
 */
async function flushPass(passName: PassName): Promise<void> {
    const batchQueue = getBatchInsertQueue();
    await batchQueue.flushAll();
    if (!batchQueue.isHealthy()) {
        log.error('Batch queue unhealthy after pass', {
            pass: passName,
            lastError: batchQueue.getLastError(),
        });
    }
}

/**
 * Refresh pass: re-scrape a rotating slice of currently-open markets so
 * mutable fields (closed, accepting_orders, volume, ...) stay in sync with
 * Gamma. Without this, the main loop's ANTI LEFT JOIN would only ever
 * insert each market once and a resolved market would remain closed=false
 * in our mirror indefinitely.
 */
async function refreshOpenMarkets(): Promise<void> {
    if (REFRESH_BATCH_SIZE <= 0) {
        log.info('Market refresh pass disabled');
        return;
    }

    const stale = await query<RegisteredToken>(
        await Bun.file(
            __dirname + '/get_stale_markets_for_refresh.sql',
        ).text(),
        {
            db: CLICKHOUSE_DATABASE_INSERT,
            limit: REFRESH_BATCH_SIZE,
        },
    );

    if (stale.data.length === 0) {
        log.info('No open markets to refresh');
        return;
    }

    log.info('Refreshing open markets', {
        count: stale.data.length,
        batchSize: REFRESH_BATCH_SIZE,
    });

    const stats = new ProcessingStats(serviceName, 'polygon');
    stats.startProgressLogging(stale.data.length);

    const queue = new PQueue({ concurrency: CONCURRENCY });
    for (const token of stale.data) {
        queue.add(async () => {
            await processToken(token, stats, { recordErrors: false });
        });
    }
    await queue.onIdle();

    stats.logCompletion();
}

/**
 * Discover sibling markets via the Gamma `/events/keyset` endpoint.
 * For each event slug not yet enriched, fetches the parent event and inserts
 * any child markets missing from our data.
 */
async function enrichEvents(): Promise<void> {
    log.info('Starting event enrichment pass');

    const eventSlugs = await query<{ event_slug: string }>(
        await Bun.file(__dirname + '/get_events_to_enrich.sql').text(),
        { db: CLICKHOUSE_DATABASE_INSERT },
    );

    if (eventSlugs.data.length === 0) {
        log.info('No events to enrich');
        return;
    }

    log.info('Enriching events', { count: eventSlugs.data.length });

    const enrichmentConcurrency = Math.max(1, Math.floor(CONCURRENCY / 2));
    const queue = new PQueue({ concurrency: enrichmentConcurrency });

    for (const { event_slug } of eventSlugs.data) {
        queue.add(async () => {
            await sleep(REQUEST_DELAY_MS);
            await processEventEnrichment(event_slug);
        });
    }

    await queue.onIdle();
    log.info('Event enrichment pass complete');
}

/**
 * Process a single event slug: fetch from Gamma, insert missing child markets.
 */
async function processEventEnrichment(eventSlug: string): Promise<void> {
    const event = await fetchEventFromApi(eventSlug);

    if (!event || !event.markets || event.markets.length === 0) {
        // Don't record in enriched table — transient API failures should be retriable
        log.debug('Event enrichment skipped', { eventSlug, hasEvent: !!event });
        return;
    }

    const allConditionIds = event.markets
        .map((m) => m.conditionId)
        .filter(Boolean);

    // Batch existence check — single query instead of per-market
    const existing = await query<{ condition_id: string }>(
        `SELECT condition_id FROM {db:Identifier}.polymarket_markets WHERE condition_id IN ({ids:Array(String)})`,
        { db: CLICKHOUSE_DATABASE_INSERT, ids: allConditionIds },
    );
    const existingSet = new Set(existing.data.map((r) => r.condition_id));

    const missingIds = allConditionIds.filter((id) => !existingSet.has(id));
    if (missingIds.length === 0) {
        await insertRow(
            'polymarket_events_enriched',
            {
                slug: eventSlug,
                markets_found: event.markets.length,
                markets_inserted: 0,
            },
            `Failed to record enrichment for ${eventSlug}`,
            {},
        );
        return;
    }

    // Batch fetch all missing markets in one API call
    const markets = await fetchMarketsFromApi(missingIds);
    if (markets.length === 0) {
        // API failure or none resolved — don't record, allow retry
        log.debug('Batch market fetch returned nothing', {
            eventSlug,
            missingCount: missingIds.length,
        });
        return;
    }
    let inserted = 0;

    for (const market of markets) {
        const clobTokenIds = parseJsonArray(market.clobTokenIds);

        // Chain fields unavailable — these markets were discovered via Gamma, not on-chain events
        const success = await insertMarket(
            market,
            clobTokenIds[0] || '0',
            clobTokenIds[1] || '0',
            market.createdAt || '1970-01-01T00:00:00Z',
            '',
            0,
        );

        if (success) {
            await insertEventsAndSeries(market, market.conditionId);
            inserted++;
        }
    }

    await insertRow(
        'polymarket_events_enriched',
        {
            slug: eventSlug,
            markets_found: event.markets.length,
            markets_inserted: inserted,
        },
        `Failed to record enrichment for ${eventSlug}`,
        {},
    );

    if (inserted > 0) {
        log.info('Event enriched', {
            eventSlug,
            marketsFound: event.markets.length,
            marketsInserted: inserted,
        });
    }
}

// Run the service if this is the main module
if (import.meta.main) {
    await run();
}
