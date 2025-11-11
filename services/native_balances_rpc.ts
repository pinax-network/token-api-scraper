import PQueue from 'p-queue';
import { getNativeBalance } from '../lib/rpc';
import { insert_native_balances, insert_error_native_balances } from '../src/insert';
import { get_accounts_for_native_balances } from '../src/queries';
import { ProgressTracker } from '../lib/progress';

const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10', 10);
const ENABLE_PROMETHEUS = process.env.ENABLE_PROMETHEUS === 'true';
const PROMETHEUS_PORT = parseInt(process.env.PROMETHEUS_PORT || '9090', 10);

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

        if (balance_hex) {
            await insert_native_balances({
                account,
                balance_hex
            });
            tracker.incrementSuccess();
        } else {
            await insert_error_native_balances(account, "zero balance");
            tracker.incrementError();
        }

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
