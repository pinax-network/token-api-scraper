import { callContract } from './lib/rpc';
import { insert_error_metadata, insert_metadata } from './src/insert';
import { get_contracts } from './src/queries';

const contracts = await get_contracts();

for (const contract of contracts) {
    try {
        // Fetch decimals (required)
        const decimals_hex = await callContract(contract, "decimals()"); // 313ce567

        // Fetch symbol & name only if decimals exists
        if (decimals_hex) {
            const symbol_hex = await callContract(contract, "symbol()"); // 95d89b41
            const name_hex = await callContract(contract, "name()"); // 06fdde03
            insert_metadata({
                contract,
                name_hex,
                symbol_hex,
                decimals_hex,
            });
            console.log(`✅ Inserted ${contract}: name=${name_hex}, symbol=${symbol_hex}, decimals=${decimals_hex}`);
        } else {
            console.warn(`⚠️ Skipping ${contract} due to missing decimals`);
            insert_error_metadata(contract, "missing decimals()");
        }

    } catch (err) {
        const message = (err as Error).message || String(err);
        console.error(`❌ Error ${contract}: ${message}`);
        insert_error_metadata(contract, message);
    }
}
