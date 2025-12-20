import {
    decodeNameHex,
    decodeNumberHex,
    decodeSymbolHex,
} from '../../lib/hex-decode';
import { createLogger } from '../../lib/logger';
import { incrementError, incrementSuccess } from '../../lib/prometheus';
import { callContract } from '../../lib/rpc';
import { insertRow } from '../../src/insert';

const log = createLogger('metadata');

export async function processMetadata(
    network: string,
    contract: string,
    block_num: number,
    serviceName: string,
) {
    try {
        // Fetch decimals (required)
        const decimals_hex = await callContract(contract, 'decimals()'); // 313ce567
        const decimals = decodeNumberHex(decimals_hex);

        // Fetch symbol & name only if decimals exists (including 0)
        if (decimals !== null) {
            const startTime = performance.now();

            // Try to fetch symbol, but allow empty string if it fails
            let symbol = '';
            try {
                const symbol_hex = await callContract(contract, 'symbol()'); // 95d89b41
                symbol = decodeSymbolHex(symbol_hex);
            } catch (err) {
                log.debug('symbol() not available or failed', {
                    contract,
                    error: (err as Error).message,
                });
            }

            // Try to fetch name, but allow empty string if it fails
            let name = '';
            try {
                const name_hex = await callContract(contract, 'name()'); // 06fdde03
                name = decodeNameHex(name_hex);
            } catch (err) {
                log.debug('name() not available or failed', {
                    contract,
                    error: (err as Error).message,
                });
            }

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
                serviceName,
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
                serviceName,
            );
        }
    } catch (err) {
        const message = (err as Error).message || String(err);
        await insert_error_metadata(contract, message, serviceName);
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
    serviceName?: string,
) {
    const success = await insertRow(
        'metadata',
        row,
        `Failed to insert metadata for contract ${row.contract}`,
    );
    if (serviceName) {
        if (success) incrementSuccess(serviceName);
        else incrementError(serviceName);
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
    serviceName?: string,
) {
    // Skip infrastructure-related errors
    if (isInfrastructureError(error)) {
        if (serviceName) {
            incrementError(serviceName);
        }
        return;
    }

    await insertRow(
        'metadata_errors',
        { contract, error },
        `Failed to insert error metadata for contract ${contract}`,
    );
    if (serviceName) {
        incrementError(serviceName);
    }
}
