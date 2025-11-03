import fs from 'fs';
import { callContract } from './lib/rpc';
import { parse_string } from './src/utils';

const contracts = [
    'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT
    'TRFe3hT5oYhjSZ6f3ji5FJ7YCfrkWnHRvh', // ETHB
    'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', // USDC
    'THbVQp8kMjStKNnf2iCY6NEzThKMK5aBHg', // DOGE
    'TXWkP3jLBqRGojUih1ShzNyDaN5Csnebok', // WETH
    'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR', // WTRX
    'TFptbWaARrWTX5Yvy3gNG5Lm8BmhPx82Bt', // WBT
    'TU3kjFuhtEo42tsCBtfYUAZxoqQ4yuSLQ5', // sTRX
]

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
        const symbol = await callContract(contract, "symbol()"); // 95d89b41
        const name = await callContract(contract, "name()"); // 06fdde03
        if (data.decimals !== null) {
            data.name_str = parse_string(name);
            data.symbol_str = parse_string(symbol);
            console.log(`  -> ${data.name_str} (${data.symbol_str}), decimals: ${data.decimals}`);
        }

    } catch (err) {
        console.error("Error:", err);
    }
}
