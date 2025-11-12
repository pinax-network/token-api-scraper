import PQueue from 'p-queue';
import { callContract, decodeUint256 } from '../lib/rpc';
import { insert_balances, insert_error_balances } from '../src/insert';
import { get_trc20_backfill_transfers } from '../src/queries';
import { ProgressTracker } from '../lib/progress';

const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10', 10);
const ENABLE_PROMETHEUS = process.env.ENABLE_PROMETHEUS === 'true';
const PROMETHEUS_PORT = parseInt(process.env.PROMETHEUS_PORT || '9090', 10);

const queue = new PQueue({ concurrency: CONCURRENCY });

console.log(`🚀 Starting TRC20 balances BACKFILL service with concurrency: ${CONCURRENCY}`);
console.log(`📝 This service processes transfers from highest to lowest block number`);
console.log(`📝 It continues non-stop until the beginning of the chain`);
if (ENABLE_PROMETHEUS) {
    console.log(`📊 Prometheus metrics enabled on port ${PROMETHEUS_PORT}`);
}

const transfers = await get_trc20_backfill_transfers();

async function processBalanceOf(account: string, contract: string, block_num: number, tracker: ProgressTracker) {
    // get `balanceOf` RPC call for the account
    try {
        const balance_hex = await callContract(contract, `balanceOf(address)`, [account]); // 70a08231
        const balance = decodeUint256(balance_hex);

        if (balance_hex) {
            await insert_balances({
                account,
                contract,
                balance_hex,
                block_num
            });
            tracker.incrementSuccess();
        } else {
            await insert_error_balances(contract, account, "zero balance", block_num);
            tracker.incrementError();
        }

    } catch (err) {
        const message = (err as Error).message || String(err);
        await insert_error_balances(contract, account, message, block_num);
        tracker.incrementError();
    }
};

function isBlackHoleAddress(address: string): boolean {
    return address === 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
}

// Calculate total tasks and collect unique contracts
const uniqueContracts = new Set<string>();
const uniqueAccounts = new Set<string>();
let totalTasks = 0;

for (const {log_address, from, to, block_num} of transfers) {
    uniqueContracts.add(log_address);
    if (!isBlackHoleAddress(from)) {
        uniqueAccounts.add(from);
        totalTasks++;
    }
    uniqueAccounts.add(to);
    totalTasks++;
}

console.log(`\n📋 Task Overview:`);
console.log(`   Unique contracts: ${uniqueContracts.size}`);
console.log(`   Unique accounts: ${uniqueAccounts.size}`);
console.log(`   Total tasks to process: ${totalTasks}`);
console.log(``);

// Initialize progress tracker
const tracker = new ProgressTracker({
    serviceName: 'TRC20 Balances Backfill',
    totalTasks,
    enablePrometheus: ENABLE_PROMETHEUS,
    prometheusPort: PROMETHEUS_PORT
});

// Process all accounts and their contracts
for (const {log_address, from, to, block_num} of transfers) {
    if (!isBlackHoleAddress(from)) {
        queue.add(() => processBalanceOf(from, log_address, block_num, tracker));
    }
    queue.add(() => processBalanceOf(to, log_address, block_num, tracker));
}

// Wait for all tasks to complete
await queue.onIdle();
tracker.complete();

// Check if we should continue processing
if (transfers.length === 10000) {
    console.log(`\n⚠️  Processed 10,000 transfers (limit reached). Run again to continue backfill.`);
} else {
    console.log(`\n✅ Backfill complete! Processed all available transfers.`);
}
