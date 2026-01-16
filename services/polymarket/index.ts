import { sleep } from 'bun';
import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { query } from '../../lib/clickhouse';
import { CONCURRENCY } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { incrementError, incrementSuccess } from '../../lib/prometheus';
import { initService } from '../../lib/service-init';
import { insertRow } from '../../src/insert';

/**
 * Delay between requests in milliseconds to avoid overwhelming the API
 */
const REQUEST_DELAY_MS = 100;

const serviceName = 'polymarket';
const log = createLogger(serviceName);

/**
 * Polymarket API base URL
 */
const POLYMARKET_API_BASE = 'https://gamma-api.polymarket.com';

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
 * Interface for the Polymarket API market response
 */
interface PolymarketMarket {
    id: string;
    question: string;
    conditionId: string;
    slug: string;
    resolutionSource: string;
    endDate: string;
    startDate: string;
    image: string;
    icon: string;
    description: string;
    outcomes: string;
    outcomePrices: string;
    createdAt: string;
    updatedAt: string;
    submitted_by: string;
    marketMakerAddress: string;
    questionID: string;
    umaEndDate: string;
    orderPriceMinTickSize: number;
    orderMinSize: number;
    endDateIso: string;
    startDateIso: string;
    negRisk: boolean;
    negRiskRequestID: string;
    negRiskOther: boolean;
    clobTokenIds: string;
    enableOrderBook: boolean;
    archived: boolean;
    new: boolean;
    featured: boolean;
    resolvedBy: string;
    restricted: boolean;
    hasReviewedDates: boolean;
    umaBond: string;
    umaReward: string;
    customLiveness: number;
    acceptingOrders: boolean;
    ready: boolean;
    funded: boolean;
    acceptingOrdersTimestamp: string;
    cyom: boolean;
    competitive: number;
    pagerDutyNotificationEnabled: boolean;
    approved: boolean;
    rewardsMinSize: number;
    rewardsMaxSpread: number;
    spread: number;
    automaticallyActive: boolean;
    clearBookOnStart: boolean;
    manualActivation: boolean;
    pendingDeployment: boolean;
    deploying: boolean;
    deployingTimestamp: string;
    rfqEnabled: boolean;
    eventStartTime: string;
    holdingRewardsEnabled: boolean;
    feesEnabled: boolean;
    requiresTranslation: boolean;
    // Volume and liquidity fields
    liquidity: string;
    volume: string;
    volumeNum: number;
    liquidityNum: number;
    volume24hr: number;
    volume1wk: number;
    volume1mo: number;
    volume1yr: number;
    volume24hrClob: number;
    volume1wkClob: number;
    volume1moClob: number;
    volume1yrClob: number;
    volumeClob: number;
    liquidityClob: number;
    // Market status
    active: boolean;
    closed: boolean;
    // Pricing
    oneDayPriceChange: number;
    oneHourPriceChange: number;
    lastTradePrice: number;
    bestBid: number;
    bestAsk: number;
    // UMA
    umaResolutionStatuses: string;
    // Events
    events: PolymarketEvent[];
}

/**
 * Interface for the Polymarket API event response
 */
interface PolymarketEvent {
    id: string;
    ticker: string;
    slug: string;
    title: string;
    description: string;
    resolutionSource: string;
    startDate: string;
    creationDate: string;
    endDate: string;
    image: string;
    icon: string;
    active: boolean;
    closed: boolean;
    archived: boolean;
    new: boolean;
    featured: boolean;
    restricted: boolean;
    liquidity: number;
    volume: number;
    openInterest: number;
    createdAt: string;
    updatedAt: string;
    competitive: number;
    volume24hr: number;
    volume1wk: number;
    volume1mo: number;
    volume1yr: number;
    enableOrderBook: boolean;
    liquidityClob: number;
    negRisk: boolean;
    commentCount: number;
    cyom: boolean;
    showAllOutcomes: boolean;
    showMarketImages: boolean;
    enableNegRisk: boolean;
    automaticallyActive: boolean;
    seriesSlug: string;
    negRiskAugmented: boolean;
    pendingDeployment: boolean;
    deploying: boolean;
    requiresTranslation: boolean;
    series: PolymarketSeries[];
}

/**
 * Interface for the Polymarket API series response
 */
interface PolymarketSeries {
    id: string;
    ticker: string;
    slug: string;
    title: string;
    seriesType: string;
    recurrence: string;
    image: string;
    icon: string;
    active: boolean;
    closed: boolean;
    archived: boolean;
    featured: boolean;
    restricted: boolean;
    createdAt: string;
    updatedAt: string;
    volume: number;
    liquidity: number;
    commentCount: number;
    requiresTranslation: boolean;
}

/**
 * Fetch market data from Polymarket API for a single condition ID
 * @param conditionId - The condition ID to query
 * @returns Market data or null if not found
 */
async function fetchMarketFromApi(
    conditionId: string,
): Promise<PolymarketMarket | null> {
    const url = `${POLYMARKET_API_BASE}/markets?condition_ids=${conditionId}&limit=1`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            log.warn('Polymarket API returned non-OK status', {
                status: response.status,
                statusText: response.statusText,
                conditionId,
            });
            return null;
        }

        const markets: PolymarketMarket[] = await response.json();

        if (markets.length === 0) {
            return null;
        }

        return markets[0];
    } catch (error) {
        log.warn('Failed to fetch market from Polymarket API', {
            conditionId,
            error: (error as Error).message,
        });
        return null;
    }
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
        timestamp,
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
        comment_count: event.commentCount || 0,
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
        comment_count: series.commentCount || 0,
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
        await insertEvent(event, condition_id);

        // Insert series for each event
        if (event.series && Array.isArray(event.series)) {
            for (const series of event.series) {
                await insertSeries(series, condition_id, event.id);
            }
        }
    }
}

/**
 * Process a single registered token
 * Fetches market data for the token and inserts into tables
 */
async function processToken(token: RegisteredToken): Promise<void> {
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
        await insertError(condition_id, token0, token1, 'Market not found');
        incrementError(serviceName);
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
        log.info('Market data scraped successfully', {
            conditionId: condition_id,
            question: (market.question || '').substring(0, 50),
        });
        incrementSuccess(serviceName);

        // Insert events and series data
        await insertEventsAndSeries(market, condition_id);
    } else {
        log.warn('Insert failure', {
            conditionId: condition_id,
        });
        incrementError(serviceName);
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

    const queue = new PQueue({ concurrency: CONCURRENCY });

    // Query for unprocessed condition_ids
    const tokens = await query<RegisteredToken>(
        await Bun.file(__dirname + '/get_unprocessed_condition_ids.sql').text(),
    );

    if (tokens.data.length > 0) {
        log.info('Found condition_ids to scrape', {
            count: tokens.data.length,
            source: 'ctfexchange_token_registered',
        });
    } else {
        log.info('No new condition_ids to process');
    }

    // Process each token individually
    for (const token of tokens.data) {
        queue.add(async () => {
            await processToken(token);
        });
    }

    // Wait for all tasks to complete
    await queue.onIdle();

    log.info('Service completed');

    // Shutdown batch insert queue
    await shutdownBatchInsertQueue();
}

// Run the service if this is the main module
if (import.meta.main) {
    await run();
}
