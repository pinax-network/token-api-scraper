import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { query } from '../../lib/clickhouse';
import { CONCURRENCY } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { incrementError, incrementSuccess } from '../../lib/prometheus';
import { initService } from '../../lib/service-init';
import { insertRow } from '../../src/insert';

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
    condition_id: string;
    question: string;
    description: string;
    market_slug: string;
    end_date_iso: string;
    game_start_time: string;
    seconds_delay: number;
    fpmm: string;
    maker_base_fee: number;
    taker_base_fee: number;
    clob_rewards: object;
    active: boolean;
    closed: boolean;
    archived: boolean;
    accepting_orders: boolean;
    accepting_order_timestamp: string;
    minimum_order_size: number;
    minimum_tick_size: number;
    neg_risk: boolean;
    neg_risk_market_id: string;
    neg_risk_request_id: string;
    notification_preferences: object;
    notifications_enabled: boolean;
    competitive: number;
    spread: number;
    last_trade_price: number;
    best_bid: number;
    best_ask: number;
    price: number;
    volume: string;
    volume_num: number;
    liquidity: string;
    liquidity_num: number;
    tokens: Array<{
        token_id: string;
        outcome: string;
        price: number;
        winner: boolean;
    }>;
}

/**
 * Fetch market data from Polymarket API using clob_token_ids
 * @param tokenId - The token ID to query (token0 or token1)
 * @returns The market data or null if not found
 */
async function fetchMarketFromApi(
    tokenId: string,
): Promise<PolymarketMarket | null> {
    const url = `${POLYMARKET_API_BASE}/markets?clob_token_ids=${tokenId}&limit=1`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            log.warn('Polymarket API returned non-OK status', {
                status: response.status,
                statusText: response.statusText,
                tokenId,
            });
            return null;
        }

        const markets: PolymarketMarket[] = await response.json();
        if (markets.length === 0) {
            log.debug('No market found for token', { tokenId });
            return null;
        }

        return markets[0];
    } catch (error) {
        log.warn('Failed to fetch market from Polymarket API', {
            tokenId,
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
        condition_id: market.condition_id,
        token0,
        token1,
        question: market.question || '',
        description: market.description || '',
        market_slug: market.market_slug || '',
        end_date_iso: market.end_date_iso || '',
        game_start_time: market.game_start_time || '',
        seconds_delay: market.seconds_delay || 0,
        fpmm: market.fpmm || '',
        maker_base_fee: market.maker_base_fee || 0,
        taker_base_fee: market.taker_base_fee || 0,
        clob_rewards: JSON.stringify(market.clob_rewards || {}),
        active: market.active || false,
        closed: market.closed || false,
        archived: market.archived || false,
        accepting_orders: market.accepting_orders || false,
        accepting_order_timestamp: market.accepting_order_timestamp || '',
        minimum_order_size: market.minimum_order_size || 0,
        minimum_tick_size: market.minimum_tick_size || 0,
        neg_risk: market.neg_risk || false,
        neg_risk_market_id: market.neg_risk_market_id || '',
        neg_risk_request_id: market.neg_risk_request_id || '',
        notification_preferences: JSON.stringify(
            market.notification_preferences || {},
        ),
        notifications_enabled: market.notifications_enabled || false,
        competitive: market.competitive || 0,
        spread: market.spread || 0,
        last_trade_price: market.last_trade_price || 0,
        best_bid: market.best_bid || 0,
        best_ask: market.best_ask || 0,
        price: market.price || 0,
        volume: parseFloat(market.volume) || 0,
        volume_num: market.volume_num || 0,
        liquidity: parseFloat(market.liquidity) || 0,
        liquidity_num: market.liquidity_num || 0,
    };

    return await insertRow(
        'polymarket_markets',
        row,
        `Failed to insert market for condition_id ${market.condition_id}`,
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
 * Process a single registered token entry
 * Fetches market data and inserts into both tables
 */
async function processRegisteredToken(token: RegisteredToken): Promise<void> {
    const { condition_id, token0, token1 } = token;
    const startTime = performance.now();

    // Try fetching with token0 first
    let market = await fetchMarketFromApi(token0);

    // If not found, try with token1
    if (!market) {
        market = await fetchMarketFromApi(token1);
    }

    if (!market) {
        log.warn('No market found for condition_id', {
            conditionId: condition_id,
            token0,
            token1,
        });
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
            question: market.question.substring(0, 50),
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
