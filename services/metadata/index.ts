import { VERBOSE } from '../../lib/config';
import {
    decodeNameHex,
    decodeNumberHex,
    decodeSymbolHex,
} from '../../lib/hex-decode';
import { createLogger } from '../../lib/logger';
import type { ProgressTracker } from '../../lib/progress';
import { callContract } from '../../lib/rpc';
import { insertRow } from '../../src/insert';

const log = createLogger('metadata');

let isFirstCall = true;

export async function processMetadata(
    network: string,
    contract: string,
    block_num: number,
    tracker: ProgressTracker,
) {
    if (VERBOSE && isFirstCall) {
        console.log(`\n🌐 Processing metadata for network: ${network}`);
        console.log(`\n📋 Task Overview:`);
        console.log(``);
        isFirstCall = false;
    }

    try {
        // Fetch decimals (required)
        const decimals_hex = await callContract(contract, 'decimals()'); // 313ce567
        const decimals = decodeNumberHex(decimals_hex);

        // Fetch symbol & name only if decimals exists (including 0)
        if (decimals !== null) {
            const startTime = performance.now();
            const symbol_hex = await callContract(contract, 'symbol()'); // 95d89b41
            const symbol = decodeSymbolHex(symbol_hex);
            const name_hex = await callContract(contract, 'name()'); // 06fdde03
            const name = decodeNameHex(name_hex);
            const queryTimeMs = Math.round(performance.now() - startTime);

            await insert_metadata(
                {
                    network,
                    contract,
                    block_num,
                    name,
                    symbol,
                    decimals,
                },
                tracker,
            );

            log.info('Metadata scraped successfully', {
                contract,
                name,
                symbol,
                decimals,
                blockNum: block_num,
                queryTimeMs,
            });
        } else {
            await insert_error_metadata(
                contract,
                'missing decimals()',
                tracker,
            );
        }
    } catch (err) {
        const message = (err as Error).message || String(err);
        await insert_error_metadata(contract, message, tracker);
    }
}

export async function insert_metadata(
    row: {
        network: string;
        contract: string;
        block_num: number;
        symbol: string;
        name: string;
        decimals: number;
    },
    tracker?: ProgressTracker,
) {
    const success = await insertRow(
        'metadata',
        row,
        `Failed to insert metadata for contract ${row.contract}`,
    );
    if (tracker) {
        if (success) tracker.incrementSuccess();
        else tracker.incrementError();
    }
}

/**
 * Check if an error is infrastructure-related and should be skipped from metadata_errors
 * These are non-deterministic network/infrastructure issues
 */
function isInfrastructureError(error: string): boolean {
    const lowerError = error.toLowerCase();

    // Network connection errors
    if (
        lowerError.includes('unable to connect') ||
        lowerError.includes('was there a typo in the url or port')
    ) {
        return true;
    }

    // HTTP status code errors that are infrastructure-related
    if (
        lowerError.includes('non-json response (status 502)') ||
        lowerError.includes('non-json response (status 404)')
    ) {
        return true;
    }

    return false;
}

export async function insert_error_metadata(
    contract: string,
    error: string,
    tracker?: ProgressTracker,
) {
    // Skip infrastructure-related errors
    if (isInfrastructureError(error)) {
        if (tracker) {
            tracker.incrementError();
        }
        return;
    }

    await insertRow(
        'metadata_errors',
        { contract, error },
        `Failed to insert error metadata for contract ${contract}`,
    );
    if (tracker) {
        tracker.incrementError();
    }
}
