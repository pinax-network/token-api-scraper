import { client } from "../lib/clickhouse";

interface TokenMetadata {
    contract: string;
    symbol_hex: string;
    name_hex: string;
    decimals_hex: string;
}

export async function insert_metadata(row: TokenMetadata) {
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