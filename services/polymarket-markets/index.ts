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

const serviceName = 'polymarket-markets';
const log = createLogger(serviceName);

/**
 * Polymarket API base URL
 */
const POLYMARKET_API_BASE = 'https://gamma-api.polymarket.com';

/**
 * Interface for the registered token data from the database
 */
interface RegisteredToken {
    condition_id: string;
    token0: string;
    token1: string;
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
    createdAt: string;
    submitted_by: string;
    questionID: string;
    umaEndDate: string;
    orderPriceMinTickSize: number;
    orderMinSize: number;
    endDateIso: string;
    startDateIso: string;
    negRisk: boolean;
    negRiskRequestID: string;
    clobTokenIds: string;
    enableOrderBook: boolean;
    archived: boolean;
}

/**
 * Fetch market data from Polymarket API using condition_id
 * @param conditionId - The condition ID to query
 * @returns The market data or null if not found
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
            log.debug('No market found for condition_id', { conditionId });
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
): Promise<boolean> {
    const row = {
        condition_id: market.conditionId || '',
        token0,
        token1,
        market_id: market.id || '',
        question: market.question || '',
        description: market.description || '',
        market_slug: market.slug || '',
        outcomes: market.outcomes || '[]',
        resolution_source: market.resolutionSource || '',
        image: market.image || '',
        icon: market.icon || '',
        question_id: market.questionID || '',
        clob_token_ids: market.clobTokenIds || '[]',
        submitted_by: market.submitted_by || '',
        enable_order_book: market.enableOrderBook || false,
        order_price_min_tick_size: market.orderPriceMinTickSize || 0,
        order_min_size: market.orderMinSize || 0,
        neg_risk: market.negRisk || false,
        neg_risk_request_id: market.negRiskRequestID || '',
        archived: market.archived || false,
        start_date: market.startDate || '',
        end_date: market.endDate || '',
        start_date_iso: market.startDateIso || '',
        end_date_iso: market.endDateIso || '',
        uma_end_date: market.umaEndDate || '',
        created_at_api: market.createdAt || '',
    };

    return await insertRow(
        'polymarket_markets',
        row,
        `Failed to insert market for condition_id ${market.conditionId}`,
        {},
    );
}

/**
 * Insert asset data into the polymarket_assets table
 */
async function insertAsset(
    assetId: string,
    conditionId: string,
): Promise<boolean> {
    return await insertRow(
        'polymarket_assets',
        {
            asset_id: assetId,
            condition_id: conditionId,
        },
        `Failed to insert asset ${assetId} for condition_id ${conditionId}`,
        {},
    );
}

/**
 * Insert error record into the polymarket_assets_errors table
 */
async function insertError(
    conditionId: string,
    token0: string,
    token1: string,
    errorReason: string,
): Promise<boolean> {
    return await insertRow(
        'polymarket_assets_errors',
        {
            condition_id: conditionId,
            token0,
            token1,
            error_reason: errorReason,
        },
        `Failed to insert error for condition_id ${conditionId}`,
        {},
    );
}

/**
 * Process a single registered token entry
 * Fetches market data and inserts into both tables
 */
async function processRegisteredToken(token: RegisteredToken): Promise<void> {
    const { condition_id, token0, token1 } = token;
    const startTime = performance.now();

    // Fetch market data using condition_id
    const market = await fetchMarketFromApi(condition_id);

    if (!market) {
        log.warn('No market found for condition_id', {
            conditionId: condition_id,
        });
        await insertError(condition_id, token0, token1, 'Market not found');
        incrementError(serviceName);
        return;
    }

    // Insert market data
    const marketSuccess = await insertMarket(market, token0, token1);

    // Insert asset data for both token0 and token1
    const asset0Success = await insertAsset(token0, condition_id);
    const asset1Success = await insertAsset(token1, condition_id);

    const queryTimeMs = Math.round(performance.now() - startTime);

    if (marketSuccess && asset0Success && asset1Success) {
        log.info('Market data scraped successfully', {
            conditionId: condition_id,
            question: (market.question || '').substring(0, 50),
            queryTimeMs,
        });
        incrementSuccess(serviceName);
    } else {
        log.warn('Partial insert failure', {
            conditionId: condition_id,
            marketSuccess,
            asset0Success,
            asset1Success,
        });
        incrementError(serviceName);
    }

    // Add delay between requests to avoid overwhelming the API
    await sleep(REQUEST_DELAY_MS);
}

/**
 * Main run function for the polymarket-markets service
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

    // Process all tokens
    for (const token of tokens.data) {
        queue.add(async () => {
            await processRegisteredToken(token);
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
