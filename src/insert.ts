import { client } from "../lib/clickhouse";
import { getBatchInsertQueue } from "../lib/batch-insert";

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
 */
async function insertRow<T>(table: string, value: T, context: string): Promise<void> {
    try {
        // Use batch insert queue
        const batchQueue = getBatchInsertQueue();
        await batchQueue.add(table, value);
    } catch (error) {
        // Log error but don't throw - allows service to continue processing other items
        handleInsertError(error, context);
    }
}

export async function insert_metadata(row: {
    contract: string;
    block_num: number;
    symbol_hex: string;
    name_hex: string;
    decimals_hex: string;
}) {
    await insertRow('metadata_rpc', row, `Failed to insert metadata for contract ${row.contract}`);
}

export async function insert_error_metadata(row: {contract: string, block_num: number}, error_msg: string) {
    await insertRow('metadata_rpc', { ...row, error_msg }, `Failed to insert error metadata for contract ${row.contract}`);
}

export async function insert_balances(row: {
    contract: string;
    account: string;
    balance_hex: string;
    block_num: number;
}) {
    await insertRow('trc20_balances_rpc', row, `Failed to insert balance for account ${row.account}`);
}

export async function insert_error_balances(row: {block_num: number, contract: string, account: string}, error_msg: string) {
    await insertRow('trc20_balances_rpc', { ...row, error_msg }, `Failed to insert error balance for account ${row.account}`);
}

export async function insert_native_balances(row: {
    account: string;
    balance_hex: string;
}) {
    await insertRow('native_balances_rpc', row, `Failed to insert native balance for account ${row.account}`);
}

export async function insert_error_native_balances(account: string, error: string) {
    await insertRow('native_balances_rpc', { account, error }, `Failed to insert error native balance for account ${account}`);
}