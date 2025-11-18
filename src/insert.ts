import { getBatchInsertQueue } from "../lib/batch-insert";
import type { ProgressTracker } from "../lib/progress";

/**
 * Interface for ClickHouse client errors
 */
interface ClickHouseError extends Error {
    code?: string;
    message: string;
}

/**
 * Helper function to handle insert errors consistently
 * Logs error details and provides specific guidance for connection issues
 */
function handleInsertError(error: unknown, context: string): void {
    const err = error as ClickHouseError;
    const errorMessage = err?.message || String(error);
    console.error(`${context}:`, errorMessage);
    if (err?.code === 'ConnectionRefused' || errorMessage?.includes('Connection refused')) {
        console.error('Unable to connect to ClickHouse. Check database connection.');
    }
}

/**
 * Insert a row into ClickHouse using batch insert
 * Returns true if successful, false if error
 */
async function insertRow<T>(table: string, value: T, context: string): Promise<boolean> {
    try {
        // Use batch insert queue
        const batchQueue = getBatchInsertQueue();
        await batchQueue.add(table, value);
        return true;
    } catch (error) {
        // Log error but don't throw - allows service to continue processing other items
        handleInsertError(error, context);
        return false;
    }
}

export async function insert_metadata(row: {
    contract: string;
    block_num: number;
    symbol_hex: string;
    name_hex: string;
    decimals_hex: string;
}, tracker?: ProgressTracker) {
    const success = await insertRow('metadata_rpc', row, `Failed to insert metadata for contract ${row.contract}`);
    if (tracker) {
        if (success) tracker.incrementSuccess();
        else tracker.incrementError();
    }
}

export async function insert_error_metadata(row: {contract: string, block_num: number}, error_msg: string, tracker?: ProgressTracker) {
    await insertRow('metadata_rpc', { ...row, error_msg }, `Failed to insert error metadata for contract ${row.contract}`);
    if (tracker) {
        tracker.incrementError();
    }
}

export async function insert_balances(row: {
    contract: string;
    account: string;
    balance_hex: string;
    block_num: number;
}, tracker?: ProgressTracker) {
    const success = await insertRow('trc20_balances_rpc', row, `Failed to insert balance for account ${row.account}`);
    if (tracker) {
        if (success) tracker.incrementSuccess();
        else tracker.incrementError();
    }
}

export async function insert_error_balances(row: {block_num: number, contract: string, account: string}, error_msg: string, tracker?: ProgressTracker) {
    await insertRow('trc20_balances_rpc', { ...row, error_msg }, `Failed to insert error balance for account ${row.account}`);
    if (tracker) {
        tracker.incrementError();
    }
}

export async function insert_native_balances(row: {
    account: string;
    balance_hex: string;
}, tracker?: ProgressTracker) {
    const success = await insertRow('native_balances_rpc', row, `Failed to insert native balance for account ${row.account}`);
    if (tracker) {
        if (success) tracker.incrementSuccess();
        else tracker.incrementError();
    }
}

export async function insert_error_native_balances(account: string, error: string, tracker?: ProgressTracker) {
    await insertRow('native_balances_rpc', { account, error }, `Failed to insert error native balance for account ${account}`);
    if (tracker) {
        tracker.incrementError();
    }
}