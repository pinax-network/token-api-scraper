import { callContract } from './lib/rpc';
import { insert_metadata } from './src/insert';
import { get_contracts } from './src/queries';
import { parse_string } from './src/utils';

const contracts = await get_contracts();

for (const contract of contracts) {
    const data: { decimals?: number | null; symbol?: string | null; name?: string | null, contract: string, name_str?: string, symbol_str?: string } = {
        decimals: null,
        symbol: null,
        name: null,
        contract,
    };
    try {
        // // Fetch decimals
        const decimalsHex = await callContract(contract, "decimals()"); // 313ce567
        if (decimalsHex) {
            try {
                const decimals = Number(decimalsHex);
                if (decimals > 18 || decimals < 0) throw new Error(`Invalid decimals: ${decimals}`);
                else data.decimals = decimals;
            } catch (err) {
                console.error(`Error parsing decimals for contract ${contract}:`, err);
            }
        }

        // Fetch symbol
        if (data.decimals !== null && data.decimals !== undefined) {
            const symbol = await callContract(contract, "symbol()"); // 95d89b41
            const name = await callContract(contract, "name()"); // 06fdde03
            data.name_str = parse_string(name);
            data.symbol_str = parse_string(symbol);
            console.log(`  -> ${data.name_str} (${data.symbol_str}), decimals: ${data.decimals}`);
            insert_metadata({
                contract: data.contract,
                name: data.name_str || '',
                symbol: data.symbol_str || '',
                decimals: data.decimals,
            });
        }

    } catch (err) {
        console.error("Error:", err);
    }
}
