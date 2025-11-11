import { client } from "../lib/clickhouse";

export async function insert_metadata(row: {
    contract: string;
    symbol_hex: string;
    name_hex: string;
    decimals_hex: string;
}) {
    client.insert({
        table: 'metadata_rpc',
        format: 'JSONEachRow',
        values: [row],
    });
}

export async function insert_error_metadata(contract: string, error: string) {
    client.insert({
        table: 'metadata_rpc',
        format: 'JSONEachRow',
        values: [{
            contract,
            error
        }],
    });
}

export async function insert_balances(row: {
    contract: string;
    account: string;
    balance_hex: string;
}) {
    client.insert({
        table: 'trc20_balances_rpc',
        format: 'JSONEachRow',
        values: [row],
    });
}

export async function insert_error_balances(contract: string, account: string, error: string) {
    client.insert({
        table: 'trc20_balances_rpc',
        format: 'JSONEachRow',
        values: [{
            contract,
            account,
            error
        }],
    });
}

export async function insert_native_balances(row: {
    account: string;
    balance_hex: string;
}) {
    client.insert({
        table: 'native_balances_rpc',
        format: 'JSONEachRow',
        values: [row],
    });
}

export async function insert_error_native_balances(account: string, error: string) {
    client.insert({
        table: 'native_balances_rpc',
        format: 'JSONEachRow',
        values: [{
            account,
            error
        }],
    });
}