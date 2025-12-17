import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import {
    CONCURRENCY,
    ENABLE_PROMETHEUS,
    PROMETHEUS_PORT,
    VERBOSE,
} from '../../lib/config';
import { ProgressTracker } from '../../lib/progress';
import { getNativeBalance } from '../../lib/rpc';
import { initService } from '../../lib/service-init';
import {
    insert_error_native_balances,
    insert_native_balances,
} from '../../src/insert';
import { get_accounts_for_native_balances } from '../../src/queries';

// Initialize service
initService({ serviceName: 'Native balances RPC service' });

const queue = new PQueue({ concurrency: CONCURRENCY });

const accounts = await get_accounts_for_native_balances();

async function processNativeBalance(account: string, tracker: ProgressTracker) {
    // get native TRX balance for the account
    try {
        const balance_hex = await getNativeBalance(account);

        // Store balance (including "0" for zero balance)
        await insert_native_balances(
            {
                account,
                balance_hex,
            },
            tracker,
        );
    } catch (err) {
        const message = (err as Error).message || String(err);
        await insert_error_native_balances(account, message, tracker);
    }
}

if (VERBOSE) {
    console.log(`\n📋 Task Overview:`);
    console.log(`   Unique accounts: ${accounts.length}`);
    console.log(`   Total tasks to process: ${accounts.length}`);
    console.log(``);
}

// Initialize progress tracker
const tracker = new ProgressTracker({
    serviceName: 'Native Balances',
    totalTasks: accounts.length,
    enablePrometheus: ENABLE_PROMETHEUS,
    prometheusPort: PROMETHEUS_PORT,
});

// Process all accounts
for (const account of accounts) {
    queue.add(() => processNativeBalance(account, tracker));
}

// Wait for all tasks to complete
await queue.onIdle();
await tracker.complete();

// Shutdown batch insert queue
if (VERBOSE) {
    console.log('⏳ Flushing remaining batch inserts...');
}
await shutdownBatchInsertQueue();
if (VERBOSE) {
    console.log('✅ Batch inserts flushed successfully');
}
