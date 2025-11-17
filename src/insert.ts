import { client } from "../lib/clickhouse";

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

export async function insert_metadata(row: {
    contract: string;
    block_num: number;
    symbol_hex: string;
    name_hex: string;
    decimals_hex: string;
}) {
    try {
        await client.insert({
            table: 'metadata_rpc',
            format: 'JSONEachRow',
            values: [row],
        });
    } catch (error) {
        // Log error but don't throw - allows service to continue processing other items
        handleInsertError(error, `Failed to insert metadata for contract ${row.contract}`);
    }
}

export async function insert_error_metadata(row: {contract: string, block_num: number}, error: string) {
    try {
        await client.insert({
            table: 'metadata_rpc',
            format: 'JSONEachRow',
            values: [{
                ...row,
                error
            }],
        });
    } catch (insertError) {
        // Log error but don't throw - allows service to continue processing other items
        handleInsertError(insertError, `Failed to insert error metadata for contract ${row.contract}`);
    }
}

export async function insert_balances(row: {
    contract: string;
    account: string;
    balance_hex: string;
    block_num: number;
}) {
    try {
        await client.insert({
            table: 'trc20_balances_rpc',
            format: 'JSONEachRow',
            values: [row],
        });
    } catch (error) {
        // Log error but don't throw - allows service to continue processing other items
        handleInsertError(error, `Failed to insert balance for account ${row.account}`);
    }
}

export async function insert_error_balances(row: {block_num: number, contract: string, account: string}, error: string) {
    try {
        await client.insert({
            table: 'trc20_balances_rpc',
            format: 'JSONEachRow',
            values: [{...row, error}],
        });
    } catch (insertError) {
        // Log error but don't throw - allows service to continue processing other items
        handleInsertError(insertError, `Failed to insert error balance for account ${row.account}`);
    }
}

export async function insert_native_balances(row: {
    account: string;
    balance_hex: string;
}) {
    try {
        await client.insert({
            table: 'native_balances_rpc',
            format: 'JSONEachRow',
            values: [row],
        });
    } catch (error) {
        // Log error but don't throw - allows service to continue processing other items
        handleInsertError(error, `Failed to insert native balance for account ${row.account}`);
    }
}

export async function insert_error_native_balances(account: string, error: string) {
    try {
        await client.insert({
            table: 'native_balances_rpc',
            format: 'JSONEachRow',
            values: [{
                account,
                error
            }],
        });
    } catch (insertError) {
        // Log error but don't throw - allows service to continue processing other items
        handleInsertError(insertError, `Failed to insert error native balance for account ${account}`);
    }
}