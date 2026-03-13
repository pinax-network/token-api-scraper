import { TOKEN_OVERRIDES_REFRESH_MS, TOKEN_OVERRIDES_URL } from './config';
import { createLogger } from './logger';

const log = createLogger('token-overrides');

interface TokenOverride {
    name: string;
    symbol: string;
}

interface TokensJsonEntry {
    network: string;
    contract: string;
    name: string;
    symbol: string;
}

/** Keyed by `${network}:${contract.toLowerCase()}` */
let cache: Map<string, TokenOverride> | null = null;
let initialized = false;

function buildKey(network: string, contract: string): string {
    return `${network}:${contract.toLowerCase()}`;
}

async function fetchOverrides(): Promise<void> {
    if (!TOKEN_OVERRIDES_URL) return;

    try {
        const res = await fetch(TOKEN_OVERRIDES_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const entries = (await res.json()) as TokensJsonEntry[];
        const map = new Map<string, TokenOverride>();

        for (const entry of entries) {
            if (entry.network && entry.contract && (entry.name || entry.symbol)) {
                map.set(buildKey(entry.network, entry.contract), {
                    name: entry.name ?? '',
                    symbol: entry.symbol ?? '',
                });
            }
        }

        cache = map;
        log.info('Token overrides loaded', { count: map.size, url: TOKEN_OVERRIDES_URL });
    } catch (err) {
        const msg = (err as Error).message;
        if (cache) {
            log.warn('Failed to refresh token overrides, keeping last cache', { error: msg });
        } else {
            log.warn('Failed to load token overrides, falling back to on-chain values', { error: msg });
        }
    }
}

/**
 * Returns CoinGecko-sourced name/symbol overrides for a contract, or null if
 * no override exists or the override list could not be loaded.
 */
export function getOverride(network: string, contract: string): TokenOverride | null {
    if (!cache) return null;
    return cache.get(buildKey(network, contract)) ?? null;
}

/**
 * Initializes the override cache and schedules periodic refreshes.
 * No-op if TOKEN_OVERRIDES_URL is not set or already initialized.
 */
export async function initTokenOverrides(): Promise<void> {
    if (!TOKEN_OVERRIDES_URL || initialized) return;
    initialized = true;

    await fetchOverrides();

    const interval = setInterval(fetchOverrides, TOKEN_OVERRIDES_REFRESH_MS);
    // Don't keep the process alive solely for the refresh timer
    interval.unref();
}
