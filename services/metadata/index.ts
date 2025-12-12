import { callContract } from '../../lib/rpc';
import { ProgressTracker } from '../../lib/progress';
import { insertRow } from '../../src/insert';
import { decodeNameHex, decodeNumberHex, decodeSymbolHex } from '../../lib/hex-decode';

export async function processMetadata(network: string, contract: string, block_num: number, tracker: ProgressTracker) {
    try {
        // Fetch decimals (required)
        const decimals_hex = await callContract(contract, "decimals()"); // 313ce567
        const decimals = decodeNumberHex(decimals_hex);

        // Fetch symbol & name only if decimals exists (including 0)
        if (decimals !== null) {
            const symbol_hex = await callContract(contract, "symbol()"); // 95d89b41
            const symbol = decodeSymbolHex(symbol_hex);
            const name_hex = await callContract(contract, "name()"); // 06fdde03
            const name = decodeNameHex(name_hex);

            await insert_metadata({
                network,
                contract,
                block_num,
                name,
                symbol,
                decimals,
            }, tracker);
        } else {
            await insert_error_metadata(contract, "missing decimals()", tracker);
        }

    } catch (err) {
        const message = (err as Error).message || String(err);
        await insert_error_metadata(contract, message, tracker);
    }
};

export async function insert_metadata(row: {
    network: string;
    contract: string;
    block_num: number;
    symbol: string;
    name: string;
    decimals: number;
}, tracker?: ProgressTracker) {
    const success = await insertRow('metadata', row, `Failed to insert metadata for contract ${row.contract}`);
    if (tracker) {
        if (success) tracker.incrementSuccess();
        else tracker.incrementError();
    }
}

export async function insert_error_metadata(contract: string, error: string, tracker?: ProgressTracker) {
    await insertRow('metadata_errors', { contract, error }, `Failed to insert error metadata for contract ${contract}`);
    if (tracker) {
        tracker.incrementError();
    }
}
