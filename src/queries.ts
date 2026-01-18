import bun from 'bun';
import { query } from '../lib/clickhouse';

// join both by_swaps & by_transfers to get more complete list
export async function get_contracts() {
    const swaps = await get_contracts_by_swaps();
    const transfers = await get_contracts_by_transfers();
    const all = new Set<string>([...swaps, ...transfers]);
    return Array.from(all);
}

export async function get_contracts_by_transfers() {
    const sql = await bun.file('./sql/get_contracts_by_transfers.sql').text();
    const result = await query<{ contract: string }>(sql);
    return result.data.map((row) => row.contract);
}

export async function get_contracts_by_swaps() {
    const sql = await bun.file('./sql/get_contracts_by_swaps.sql').text();
    const result = await query<{ contract: string }>(sql);
    return result.data.map((row) => row.contract);
}

export async function get_distinct_accounts() {
    const sql = await bun.file('./sql/get_distinct_accounts.sql').text();
    const result = await query<{ account: string }>(sql);
    return result.data.map((row) => row.account);
}

export async function get_distinct_contracts_by_account(account: string) {
    const sql = await bun
        .file('./sql/get_distinct_contracts_by_account.sql')
        .text();
    const result = await query<{ log_address: string }>(sql, { account });
    return result.data.map((row) => row.log_address);
}
