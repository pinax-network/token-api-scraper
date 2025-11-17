import { client } from "../lib/clickhouse";

export async function insert_metadata(row: {
    contract: string;
    block_num: number;
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

export async function insert_error_metadata(row: {contract: string, block_num: number}, error: string) {
    client.insert({
        table: 'metadata_rpc',
        format: 'JSONEachRow',
        values: [{
            ...row,
            error
        }],
    });
}

export async function insert_balances(row: {
    contract: string;
    account: string;
    balance_hex: string;
    block_num: number;
}) {
    client.insert({
        table: 'trc20_balances_rpc',
        format: 'JSONEachRow',
        values: [row],
    });
}

export async function insert_error_balances(row: {block_num: number, contract: string, account: string}, error: string) {
    client.insert({
        table: 'trc20_balances_rpc',
        format: 'JSONEachRow',
        values: [{...row, error}],
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