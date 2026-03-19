import { insertRow } from '../src/insert';
import { query } from './clickhouse';
import { getNetwork } from './config';
import { createLogger } from './logger';

const log = createLogger('token-overrides');
const MAX_UINT32 = 0xffffffff;

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

function escapeSqlString(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
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
            if (
                entry.network &&
                entry.contract &&
                (entry.name || entry.symbol)
            ) {
                map.set(buildKey(entry.network, entry.contract), {
                    name: entry.name ?? '',
                    symbol: entry.symbol ?? '',
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
    overrides: Map<string, TokenOverride>,
): Promise<ExistingMetadataRow[]> {
    const contracts = Array.from(overrides.keys())
        .filter((key) => key.startsWith(`${network}:`))
        .map((key) => key.slice(network.length + 1));

    if (contracts.length === 0) {
        return [];
    }

    const contractList = contracts
        .map((contract) => `'${escapeSqlString(contract)}'`)
        .join(', ');

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
              AND lower(contract) IN (${contractList})
            GROUP BY network, normalized_contract
        `,
        { network },
    );

    return result.data;
}

function getNextBlockNum(blockNum: number): number | null {
    if (blockNum >= MAX_UINT32) {
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
    const rows = await loadExistingMetadata(network, overrides);

    if (rows.length === 0) {
        log.info('No existing metadata rows matched token overrides', {
            network,
            overrideCount: overrides.size,
            url: tokenOverridesUrl,
        });
        return;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    let appliedCount = 0;
    let skippedCount = 0;
    let unchangedCount = 0;

    for (const row of rows) {
        const override =
            overrides.get(buildKey(network, row.normalized_contract)) ?? null;
        if (!override) continue;

        const name = override.name || row.name;
        const symbol = override.symbol || row.symbol;

        if (name === row.name && symbol === row.symbol) {
            unchangedCount++;
            continue;
        }

        const block_num = getNextBlockNum(row.block_num);
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
                decimals: row.decimals,
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
        url: tokenOverridesUrl,
    });
}

export function resetTokenOverridesForTests(): void {
    initialized = false;
}
