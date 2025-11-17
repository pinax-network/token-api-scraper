import { client } from "../lib/clickhouse";

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
    } catch (error: any) {
        // Log error but don't throw - allows service to continue processing other items
        console.error(`Failed to insert metadata for contract ${row.contract}:`, error.message);
        if (error.code === 'ConnectionRefused' || error.message?.includes('Connection refused')) {
            console.error('Unable to connect to ClickHouse. Check database connection.');
        }
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
    } catch (insertError: any) {
        // Log error but don't throw - allows service to continue processing other items
        console.error(`Failed to insert error metadata for contract ${row.contract}:`, insertError.message);
        if (insertError.code === 'ConnectionRefused' || insertError.message?.includes('Connection refused')) {
            console.error('Unable to connect to ClickHouse. Check database connection.');
        }
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
    } catch (error: any) {
        // Log error but don't throw - allows service to continue processing other items
        console.error(`Failed to insert balance for account ${row.account}:`, error.message);
        if (error.code === 'ConnectionRefused' || error.message?.includes('Connection refused')) {
            console.error('Unable to connect to ClickHouse. Check database connection.');
        }
    }
}

export async function insert_error_balances(row: {block_num: number, contract: string, account: string}, error: string) {
    try {
        await client.insert({
            table: 'trc20_balances_rpc',
            format: 'JSONEachRow',
            values: [{...row, error}],
        });
    } catch (insertError: any) {
        // Log error but don't throw - allows service to continue processing other items
        console.error(`Failed to insert error balance for account ${row.account}:`, insertError.message);
        if (insertError.code === 'ConnectionRefused' || insertError.message?.includes('Connection refused')) {
            console.error('Unable to connect to ClickHouse. Check database connection.');
        }
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
    } catch (error: any) {
        // Log error but don't throw - allows service to continue processing other items
        console.error(`Failed to insert native balance for account ${row.account}:`, error.message);
        if (error.code === 'ConnectionRefused' || error.message?.includes('Connection refused')) {
            console.error('Unable to connect to ClickHouse. Check database connection.');
        }
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
    } catch (insertError: any) {
        // Log error but don't throw - allows service to continue processing other items
        console.error(`Failed to insert error native balance for account ${account}:`, insertError.message);
        if (insertError.code === 'ConnectionRefused' || insertError.message?.includes('Connection refused')) {
            console.error('Unable to connect to ClickHouse. Check database connection.');
        }
    }
}