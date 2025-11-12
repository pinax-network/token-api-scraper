import PQueue from 'p-queue';
import { getNativeBalance } from '../lib/rpc';
import { insert_native_balances, insert_error_native_balances } from '../src/insert';
import { get_accounts_for_native_balances } from '../src/queries';
import { ProgressTracker } from '../lib/progress';
import { CONCURRENCY, ENABLE_PROMETHEUS, PROMETHEUS_PORT } from '../lib/config';

const queue = new PQueue({ concurrency: CONCURRENCY });

console.log(`🚀 Starting Native balances RPC service with concurrency: ${CONCURRENCY}`);
if (ENABLE_PROMETHEUS) {
    console.log(`📊 Prometheus metrics enabled on port ${PROMETHEUS_PORT}`);
}

const accounts = await get_accounts_for_native_balances();

async function processNativeBalance(account: string, tracker: ProgressTracker) {
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
    serviceName: 'Native Balances',
    totalTasks: accounts.length,
    enablePrometheus: ENABLE_PROMETHEUS,
    prometheusPort: PROMETHEUS_PORT
});

// Process all accounts
for (const account of accounts) {
    queue.add(() => processNativeBalance(account, tracker));
}

// Wait for all tasks to complete
await queue.onIdle();
tracker.complete();
