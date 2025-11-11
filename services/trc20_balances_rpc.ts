import PQueue from 'p-queue';
import { callContract, decodeUint256 } from '../lib/rpc';
import { insert_balances, insert_error_balances } from '../src/insert';
import { get_distinct_accounts, get_distinct_contracts_by_account } from '../src/queries';

const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10', 10);
const queue = new PQueue({ concurrency: CONCURRENCY });

console.log(`🚀 Starting TRC20 balances RPC service with concurrency: ${CONCURRENCY}`);

const accounts = await get_distinct_accounts();

const processAccountContract = async (account: string, contract: string) => {
    // get `balanceOf` RPC call for the account
    try {
        const balance_hex = await callContract(contract, `balanceOf(address)`, [account]); // 70a08231
        const balance = decodeUint256(balance_hex);

        if (balance_hex) {
            console.log(`✅ ${account} | ${contract} (${balance})`);
            await insert_balances({
                account,
                contract,
                balance_hex
            });
        } else {
            console.warn(`⚠️ Account ${account} has zero balance on contract ${contract}`);
            await insert_error_balances(contract, account, "zero balance");
        }

    } catch (err) {
        const message = (err as Error).message || String(err);
        console.error(`❌ Error fetching balance for account ${account} on contract ${contract}: ${message}`);
        await insert_error_balances(contract, account, message);
    }
};

// Process all accounts and their contracts
for (const account of accounts) {
    if ( account === 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb') continue // skip Black Hole address
    const contracts = await get_distinct_contracts_by_account(account);
    for (const contract of contracts) {
        queue.add(() => processAccountContract(account, contract));
    }
}

// Wait for all tasks to complete
await queue.onIdle();
console.log(`✨ All account balances processed!`);
