import { createLogger } from '../../lib/logger';

/**
 * Per-request timeout for Gamma API calls. Without this, a stalled TCP
 * connection (which Polymarket occasionally emits when heavily rate-limited)
 * can hang the entire PQueue and deadlock the scraper.
 */
const FETCH_TIMEOUT_MS = parseInt(
    process.env.POLYMARKET_FETCH_TIMEOUT_MS || '30000',
    10,
);

/**
 * Maximum items the Gamma keyset endpoints accept per request. Above this they
 * silently truncate, so we chunk batched calls and never set `limit` higher.
 */
const KEYSET_PAGE_LIMIT = 1000;

const POLYMARKET_API_BASE = 'https://gamma-api.polymarket.com';

const log = createLogger('polymarket');

/**
 * Polymarket market shape returned from `/markets/keyset`. Field set tracks the
 * scraper's needs; Gamma may add more fields without breaking us.
 */
export interface PolymarketMarket {
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
    active: boolean;
    closed: boolean;
    oneDayPriceChange: number;
    oneHourPriceChange: number;
    lastTradePrice: number;
    bestBid: number;
    bestAsk: number;
    umaResolutionStatuses: string;
    events: PolymarketEvent[];
}

export interface PolymarketEvent {
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

export interface PolymarketSeries {
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
 * Items inside the Gamma `/events/keyset` response (simplified — only fields
 * we need for sibling-market enrichment).
 */
export interface GammaEvent {
    id: string;
    slug: string;
    title: string;
    markets?: { conditionId: string; question: string }[];
}

/**
 * Fetch a list from a Gamma keyset endpoint. The keyset variants wrap the
 * collection in a top-level object keyed by the resource name (e.g. `markets`
 * or `events`) alongside an optional `next_cursor`. Callers chunk inputs to
 * stay within `KEYSET_PAGE_LIMIT`, so we ignore `next_cursor` and just return
 * the array.
 */
export async function fetchGammaApi<T>(
    path: string,
    wrapperKey: 'markets' | 'events',
    context: Record<string, string>,
): Promise<T[]> {
    const url = `${POLYMARKET_API_BASE}${path}`;

    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
            log.warn('Polymarket API returned non-OK status', {
                path,
                status: response.status,
                statusText: response.statusText,
                ...context,
            });
            return [];
        }
        const json = (await response.json()) as Record<string, unknown>;
        const items = json?.[wrapperKey];
        if (Array.isArray(items)) return items as T[];
        log.warn('Polymarket API returned unexpected response shape', {
            path,
            wrapperKey,
            topLevelKeys: Object.keys(json ?? {}),
            ...context,
        });
        return [];
    } catch (error) {
        log.warn('Failed to fetch from Polymarket API', {
            path,
            ...context,
            error: (error as Error).message,
        });
        return [];
    }
}

function buildMarketParams(ids: string[], closed?: boolean) {
    const params = new URLSearchParams();
    for (const id of ids) params.append('condition_ids', id);
    params.set('limit', String(ids.length));
    if (closed) params.set('closed', 'true');
    return params;
}

export async function fetchMarketFromApi(
    conditionId: string,
): Promise<PolymarketMarket | null> {
    const results = await fetchMarketsFromApi([conditionId]);
    return results[0] ?? null;
}

export async function fetchMarketsFromApi(
    conditionIds: string[],
): Promise<PolymarketMarket[]> {
    if (conditionIds.length > KEYSET_PAGE_LIMIT) {
        const chunks: PolymarketMarket[][] = [];
        for (let i = 0; i < conditionIds.length; i += KEYSET_PAGE_LIMIT) {
            chunks.push(
                await fetchMarketsFromApi(
                    conditionIds.slice(i, i + KEYSET_PAGE_LIMIT),
                ),
            );
        }
        return chunks.flat();
    }
    const ctx = { conditionIdCount: String(conditionIds.length) };
    const results = await fetchGammaApi<PolymarketMarket>(
        `/markets/keyset?${buildMarketParams(conditionIds)}`,
        'markets',
        ctx,
    );
    if (results.length >= conditionIds.length) return results;
    const foundIds = new Set(results.map((m) => m.conditionId));
    const missingIds = conditionIds.filter((id) => !foundIds.has(id));
    if (missingIds.length === 0) return results;
    const closedResults = await fetchGammaApi<PolymarketMarket>(
        `/markets/keyset?${buildMarketParams(missingIds, true)}`,
        'markets',
        ctx,
    );
    return [...results, ...closedResults];
}

export function fetchEventFromApi(
    eventSlug: string,
): Promise<GammaEvent | null> {
    return fetchGammaApi<GammaEvent>(
        `/events/keyset?slug=${encodeURIComponent(eventSlug)}`,
        'events',
        { eventSlug },
    ).then((r) => r[0] ?? null);
}
