import { insertClient } from '../../lib/clickhouse';
import { createLogger } from '../../lib/logger';
import { incrementError, incrementSuccess } from '../../lib/prometheus';
import { initService } from '../../lib/service-init';
import {
    fetchSpotMeta,
    type HyperliquidSpotMeta,
    resolvePairNames,
} from './info';

const serviceName = 'hyperliquid';
const log = createLogger(serviceName);

/**
 * Fetch the latest spot universe + tokens, resolve `@N` pair names into their
 * `BASE/QUOTE` market names with split base/quote token symbols, and snapshot
 * all rows into `state_spot_pair_names` with a fresh `refresh_time`. The CLI
 * runner loops with `AUTO_RESTART_DELAY` between iterations, so a single
 * `run()` invocation maps to one poll cycle.
 */
export async function run(): Promise<void> {
    initService({ serviceName });

    const infoUrl = process.env.HYPERLIQUID_INFO_URL;
    if (!infoUrl) {
        throw new Error(
            'HYPERLIQUID_INFO_URL is required (set to a Hyperliquid /info endpoint)',
        );
    }

    log.info('Fetching spot metadata');
    const startTime = performance.now();

    let meta: HyperliquidSpotMeta;
    try {
        meta = await fetchSpotMeta(infoUrl);
    } catch (error) {
        log.error('Failed to fetch spot metadata', { error });
        incrementError(serviceName);
        throw error;
    }

    const fetchTimeMs = Math.round(performance.now() - startTime);
    const rows = resolvePairNames(meta);

    log.info('Resolved spot pair names', {
        pairs: meta.universe.length,
        tokens: meta.tokens.length,
        rows: rows.length,
        fetchTimeMs,
    });

    if (rows.length === 0) {
        log.warn('Empty spot universe — skipping insert');
        return;
    }

    // ClickHouse DateTime64(3, 'UTC') rejects the trailing `Z`, so trim it
    // but keep the millisecond precision so closely-spaced polls produce
    // distinct `refresh_time` values (deterministic RMT merges).
    const refresh_time = new Date()
        .toISOString()
        .slice(0, 23)
        .replace('T', ' ');
    const values = rows.map((r) => ({ ...r, refresh_time }));

    try {
        await insertClient.insert({
            table: 'state_spot_pair_names',
            values,
            format: 'JSONEachRow',
        });
    } catch (error) {
        log.error('Failed to insert spot pair names', { error });
        incrementError(serviceName);
        throw error;
    }

    log.info('Inserted spot pair names', { count: values.length });
    incrementSuccess(serviceName);
}

if (import.meta.main) {
    await run();
}
