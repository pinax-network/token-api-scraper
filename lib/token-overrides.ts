import { insertRow } from '../src/insert';
import { query } from './clickhouse';
import { getNetwork } from './config';
import { createLogger } from './logger';

const log = createLogger('token-overrides');
const MAX_UINT32 = 0xffffffff;
const DEFAULT_OVERRIDE_DECIMALS = 18;

interface TokenOverride {
    contract: string;
    name: string;
    symbol: string;
    decimals: number | null;
}

interface TokensJsonEntry {
    network: string;
    contract: string;
    name?: string;
    symbol?: string;
    decimals?: number;
}

interface ExistingMetadataRow {
    network: string;
    normalized_contract: string;
    contract: string;
    decimals: number;
    name: string;
    symbol: string;
    block_num: number;
}

let initialized = false;

function buildKey(network: string, contract: string): string {
    return `${network}:${contract.toLowerCase()}`;
}

function getTokenOverridesUrl(): string | undefined {
    return process.env.TOKEN_OVERRIDES_URL;
}

/**
 * Validates an override decimals value from tokens.json.
 * Returns a UInt8-compatible value (0-255) or null when the entry is invalid.
 */
function validateOverrideDecimals(value: unknown): number | null {
    if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 255
    ) {
        return null;
    }

    return value;
}

async function fetchOverrides(): Promise<Map<string, TokenOverride> | null> {
    const tokenOverridesUrl = getTokenOverridesUrl();
    if (!tokenOverridesUrl) return null;

    try {
        const res = await fetch(tokenOverridesUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const entries = (await res.json()) as TokensJsonEntry[];
        const map = new Map<string, TokenOverride>();

        for (const entry of entries) {
            const decimals = validateOverrideDecimals(entry.decimals);
            if (
                entry.network &&
                entry.contract &&
                (entry.name || entry.symbol || decimals !== null)
            ) {
                map.set(buildKey(entry.network, entry.contract), {
                    contract: entry.contract,
                    name: entry.name ?? '',
                    symbol: entry.symbol ?? '',
                    decimals,
                });
            }
        }

        log.info('Token overrides loaded', {
            count: map.size,
            url: tokenOverridesUrl,
        });
        return map;
    } catch (err) {
        const msg = (err as Error).message;
        log.warn(
            'Failed to load token overrides, skipping startup override application',
            { error: msg },
        );
        return null;
    }
}

async function loadExistingMetadata(
    network: string,
    normalizedContracts: string[],
): Promise<ExistingMetadataRow[]> {
    if (normalizedContracts.length === 0) {
        return [];
    }

    const result = await query<ExistingMetadataRow>(
        `
            SELECT
                network,
                lower(contract) AS normalized_contract,
                argMax(contract, block_num) AS contract,
                argMax(decimals, block_num) AS decimals,
                argMax(name, block_num) AS name,
                argMax(symbol, block_num) AS symbol,
                max(block_num) AS block_num
            FROM metadata
            WHERE network = {network:String}
              AND lower(contract) IN {contracts:Array(String)}
            GROUP BY network, normalized_contract
        `,
        { network, contracts: normalizedContracts },
    );

    return result.data;
}

/**
 * Filters override entries down to the current network and returns them with
 * the normalized contract portion of the cache key for metadata lookups.
 */
function getNetworkOverrides(
    network: string,
    overrides: Map<string, TokenOverride>,
): Array<{ normalizedContract: string; override: TokenOverride }> {
    const networkOverrides: Array<{
        normalizedContract: string;
        override: TokenOverride;
    }> = [];

    for (const [key, override] of overrides.entries()) {
        if (key.startsWith(`${network}:`)) {
            networkOverrides.push({
                normalizedContract: key.slice(network.length + 1),
                override,
            });
        }
    }

    return networkOverrides;
}

function tryIncrementBlockNum(blockNum: number): number | null {
    if (blockNum === MAX_UINT32) {
        return null;
    }

    return blockNum + 1;
}

/**
 * Applies metadata overrides to existing metadata rows once at service startup.
 * No-op if TOKEN_OVERRIDES_URL is not set or startup overrides already ran.
 */
export async function initTokenOverrides(): Promise<void> {
    const tokenOverridesUrl = getTokenOverridesUrl();
    if (!tokenOverridesUrl || initialized) return;
    initialized = true;

    const overrides = await fetchOverrides();
    if (!overrides || overrides.size === 0) return;

    const network = getNetwork();
    const networkOverrides = getNetworkOverrides(network, overrides);
    if (networkOverrides.length === 0) {
        log.info('No token overrides matched the current network', {
            network,
            overrideCount: overrides.size,
            url: tokenOverridesUrl,
        });
        return;
    }

    const rows = await loadExistingMetadata(
        network,
        networkOverrides.map(({ normalizedContract }) => normalizedContract),
    );
    const rowsByContract = new Map(
        rows.map((row) => [row.normalized_contract, row] as const),
    );

    const timestamp = Math.floor(Date.now() / 1000);
    let appliedCount = 0;
    let skippedCount = 0;
    let unchangedCount = 0;
    let insertedMissingCount = 0;

    for (const { normalizedContract, override } of networkOverrides) {
        const row = rowsByContract.get(normalizedContract);

        if (!row) {
            const success = await insertRow(
                'metadata',
                {
                    network,
                    contract: override.contract,
                    block_num: 0,
                    timestamp,
                    // Default to the standard ERC-20 precision when an override token
                    // is not in metadata yet and no explicit decimals value is provided.
                    decimals: override.decimals ?? DEFAULT_OVERRIDE_DECIMALS,
                    name: override.name,
                    symbol: override.symbol,
                },
                `Failed to insert metadata for override token ${override.contract}`,
                { contract: override.contract },
            );

            if (success) {
                appliedCount++;
                insertedMissingCount++;
            } else {
                skippedCount++;
            }
            continue;
        }

        const name = override.name || row.name;
        const symbol = override.symbol || row.symbol;
        const decimals = override.decimals ?? row.decimals;

        if (
            name === row.name &&
            symbol === row.symbol &&
            decimals === row.decimals
        ) {
            unchangedCount++;
            continue;
        }

        const block_num = tryIncrementBlockNum(row.block_num);
        if (block_num === null) {
            skippedCount++;
            log.warn(
                'Skipped token override because block number reached UInt32 max',
                {
                    contract: row.contract,
                    blockNum: row.block_num,
                },
            );
            continue;
        }

        const success = await insertRow(
            'metadata',
            {
                network: row.network,
                contract: row.contract,
                block_num,
                timestamp,
                decimals,
                name,
                symbol,
            },
            `Failed to apply token override for contract ${row.contract}`,
            { contract: row.contract },
        );

        if (success) {
            appliedCount++;
        } else {
            skippedCount++;
        }
    }

    log.info('Token overrides applied at startup', {
        network,
        overrideCount: overrides.size,
        matchedCount: rows.length,
        appliedCount,
        skippedCount,
        unchangedCount,
        insertedMissingCount,
        url: tokenOverridesUrl,
    });
}

export function resetTokenOverridesForTests(): void {
    initialized = false;
}
