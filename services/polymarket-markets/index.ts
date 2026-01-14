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

/**
 * Number of condition_ids to fetch in a single API batch request
 * Polymarket API supports multiple condition_id query parameters
 */
const BATCH_SIZE = 50;

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
 * Fetch market data from Polymarket API using multiple condition_ids in a single batch request
 * @param conditionIds - Array of condition IDs to query
 * @returns Map of conditionId to market data (markets not found will not be in the map)
 */
async function fetchMarketsFromApi(
    conditionIds: string[],
): Promise<Map<string, PolymarketMarket>> {
    const result = new Map<string, PolymarketMarket>();

    if (conditionIds.length === 0) {
        return result;
    }

    // Build URL with condition_ids as comma-separated list
    const params = new URLSearchParams();
    params.append('condition_ids', conditionIds.join(','));
    params.append('limit', String(conditionIds.length));

    const url = `${POLYMARKET_API_BASE}/markets?${params.toString()}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            log.warn('Polymarket API returned non-OK status', {
                status: response.status,
                statusText: response.statusText,
                conditionIdCount: conditionIds.length,
            });
            return result;
        }

        const markets: PolymarketMarket[] = await response.json();

        // Create a map from conditionId to market for easy lookup
        for (const market of markets) {
            if (market.conditionId) {
                result.set(market.conditionId, market);
            }
        }

        log.debug('Fetched markets from API', {
            requested: conditionIds.length,
            found: result.size,
        });
    } catch (error) {
        log.warn('Failed to fetch markets from Polymarket API', {
            conditionIdCount: conditionIds.length,
            error: (error as Error).message,
        });
    }

    return result;
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
 * Insert error record into the polymarket_markets_errors table
 */
async function insertError(
    conditionId: string,
    token0: string,
    token1: string,
    errorReason: string,
): Promise<boolean> {
    return await insertRow(
        'polymarket_markets_errors',
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
 * Process a batch of registered tokens
 * Fetches market data for all tokens in a single API request and inserts into tables
 */
async function processBatch(tokens: RegisteredToken[]): Promise<void> {
    if (tokens.length === 0) {
        return;
    }

    const startTime = performance.now();

    // Fetch all markets in a single batch request
    const conditionIds = tokens.map((t) => t.condition_id);
    const marketsMap = await fetchMarketsFromApi(conditionIds);

    const batchQueryTimeMs = Math.round(performance.now() - startTime);

    log.debug('Batch API request completed', {
        requested: conditionIds.length,
        found: marketsMap.size,
        batchQueryTimeMs,
    });

    // Process each token in the batch
    for (const token of tokens) {
        const { condition_id, token0, token1 } = token;
        const market = marketsMap.get(condition_id);

        if (!market) {
            log.warn('No market found for condition_id', {
                conditionId: condition_id,
            });
            await insertError(condition_id, token0, token1, 'Market not found');
            incrementError(serviceName);
            continue;
        }

        // Insert market data
        const marketSuccess = await insertMarket(market, token0, token1);

        if (marketSuccess) {
            log.info('Market data scraped successfully', {
                conditionId: condition_id,
                question: (market.question || '').substring(0, 50),
            });
            incrementSuccess(serviceName);
        } else {
            log.warn('Partial insert failure', {
                conditionId: condition_id,
                marketSuccess,
            });
            incrementError(serviceName);
        }
    }

    // Add delay between batch requests to avoid overwhelming the API
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

    // Process tokens in batches
    for (let i = 0; i < tokens.data.length; i += BATCH_SIZE) {
        const batch = tokens.data.slice(i, i + BATCH_SIZE);
        queue.add(async () => {
            await processBatch(batch);
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
