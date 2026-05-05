import { createLogger } from '../../lib/logger';

/**
 * Per-request timeout for Hyperliquid Info API calls. Without this, a stalled
 * TCP connection can hang the run loop indefinitely.
 */
const FETCH_TIMEOUT_MS = parseInt(
    process.env.HYPERLIQUID_FETCH_TIMEOUT_MS || '30000',
    10,
);

const log = createLogger('hyperliquid');

/**
 * Token entry returned by `spotMeta`. `tokens[].index` matches the indexes
 * referenced in `universe[].tokens`. `evmContract` is null for tokens that
 * don't have a HyperEVM mirror.
 */
export interface HyperliquidSpotToken {
    name: string;
    fullName: string | null;
    index: number;
    tokenId: string;
    szDecimals: number;
    weiDecimals: number;
    isCanonical: boolean;
    evmContract: {
        address: string;
        evm_extra_wei_decimals: number;
    } | null;
    deployerTradingFeeShare: string;
}

/**
 * Universe entry returned by `spotMeta`. `tokens` is `[base_index, quote_index]`
 * referencing `tokens[].index`. `name` is `@N` for auction-deployed pairs (where
 * N matches `index`) or a canonical human form like `PURR/USDC`.
 */
export interface HyperliquidSpotPair {
    tokens: [number, number];
    name: string;
    index: number;
    isCanonical: boolean;
}

export interface HyperliquidSpotMeta {
    tokens: HyperliquidSpotToken[];
    universe: HyperliquidSpotPair[];
}

export interface SpotPairNameRow {
    spot_coin: string;
    pair_name: string;
}

/**
 * POST `{type: spotMeta}` to the Hyperliquid Info API. Returns the parsed
 * response body. The Info API mirrors the public REST shape on
 * `https://api.hyperliquid.xyz/info`; any URL pointing at a compatible
 * `--serve-info` reader works equivalently.
 */
export async function fetchSpotMeta(
    infoUrl: string,
): Promise<HyperliquidSpotMeta> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(infoUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'spotMeta' }),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(
                `Hyperliquid /info returned HTTP ${response.status}`,
            );
        }

        const body = (await response.json()) as HyperliquidSpotMeta;

        if (!Array.isArray(body.tokens) || !Array.isArray(body.universe)) {
            throw new Error(
                'Hyperliquid /info spotMeta response missing tokens/universe arrays',
            );
        }

        return body;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Resolve `@N` pair names into `BASE/QUOTE` strings using the token table.
 * Canonical pairs (`PURR/USDC`) come through with their human name already set
 * — those pass through unchanged. Auction-deployed pairs (`@107`) get joined
 * against the token index to produce `HYPE/USDC`.
 *
 * The `spot_coin` column is the value substreams writes into `coin` on fills,
 * so Token API can JOIN directly: `LEFT JOIN state_spot_pair_names AS n FINAL
 * ON n.spot_coin = coin`.
 */
export function resolvePairNames(meta: HyperliquidSpotMeta): SpotPairNameRow[] {
    const tokensByIndex = new Map<number, HyperliquidSpotToken>();
    for (const token of meta.tokens) {
        tokensByIndex.set(token.index, token);
    }

    const rows: SpotPairNameRow[] = [];
    for (const pair of meta.universe) {
        if (pair.name.startsWith('@')) {
            const [baseIdx, quoteIdx] = pair.tokens;
            const base = tokensByIndex.get(baseIdx);
            const quote = tokensByIndex.get(quoteIdx);
            if (!base || !quote) {
                log.warn('Spot pair references unknown token index', {
                    pair,
                });
                continue;
            }
            rows.push({
                spot_coin: pair.name,
                pair_name: `${base.name}/${quote.name}`,
            });
        } else {
            // canonical pair — name already in BASE/QUOTE form
            rows.push({ spot_coin: pair.name, pair_name: pair.name });
        }
    }
    return rows;
}
