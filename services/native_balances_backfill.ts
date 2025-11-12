import PQueue from 'p-queue';
import { getNativeBalance } from '../lib/rpc';
import { insert_native_balances, insert_error_native_balances } from '../src/insert';
import { get_native_backfill_accounts } from '../src/queries';
import { ProgressTracker } from '../lib/progress';
import { CONCURRENCY, ENABLE_PROMETHEUS, PROMETHEUS_PORT } from '../lib/config';

const queue = new PQueue({ concurrency: CONCURRENCY });

console.log(`🚀 Starting Native balances BACKFILL service with concurrency: ${CONCURRENCY}`);
console.log(`📝 This service processes accounts from highest to lowest block number`);
console.log(`📝 It continues non-stop until the beginning of the chain`);
if (ENABLE_PROMETHEUS) {
    console.log(`📊 Prometheus metrics enabled on port ${PROMETHEUS_PORT}`);
}

const accounts = await get_native_backfill_accounts();

async function processNativeBalance(account: string, last_seen_block: number, tracker: ProgressTracker) {
    // get native TRX balance for the account
    try {
        const balance_hex = await getNativeBalance(account);

        // Store balance (including "0" for zero balance)
        await insert_native_balances({
            account,
            balance_hex
        });
        tracker.incrementSuccess();

    } catch (err) {
        const message = (err as Error).message || String(err);
        await insert_error_native_balances(account, message);
        tracker.incrementError();
    }
}

console.log(`\n📋 Task Overview:`);
console.log(`   Unique accounts: ${accounts.length}`);
console.log(`   Total tasks to process: ${accounts.length}`);
console.log(``);

// Initialize progress tracker
const tracker = new ProgressTracker({
    serviceName: 'Native Balances Backfill',
    totalTasks: accounts.length,
    enablePrometheus: ENABLE_PROMETHEUS,
    prometheusPort: PROMETHEUS_PORT
});

// Process all accounts (ordered from highest to lowest block)
for (const {account, last_seen_block} of accounts) {
    queue.add(() => processNativeBalance(account, last_seen_block, tracker));
}

// Wait for all tasks to complete
await queue.onIdle();
tracker.complete();

// Check if we should continue processing
if (accounts.length === 10000) {
    console.log(`\n⚠️  Processed 10,000 accounts (limit reached). Run again to continue backfill.`);
} else {
    console.log(`\n✅ Backfill complete! Processed all available accounts.`);
}
