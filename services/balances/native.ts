import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { CONCURRENCY, PROMETHEUS_PORT, VERBOSE } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { ProgressTracker } from '../../lib/progress';
import { getNativeBalance } from '../../lib/rpc';
import { initService } from '../../lib/service-init';
import {
    insert_error_native_balances,
    insert_native_balances,
} from '../../src/insert';
import { get_accounts_for_native_balances } from '../../src/queries';

const log = createLogger('balances-native');

async function processNativeBalance(account: string, tracker: ProgressTracker) {
    // get native TRX balance for the account
    const startTime = performance.now();
    try {
        const balance_hex = await getNativeBalance(account);
        const queryTimeMs = Math.round(performance.now() - startTime);

        // Store balance (including "0" for zero balance)
        await insert_native_balances(
            {
                account,
                balance_hex,
            },
            tracker,
        );

        log.info('Native balance scraped successfully', {
            account,
            balanceHex: balance_hex,
            queryTimeMs,
        });
    } catch (err) {
        const message = (err as Error).message || String(err);
        await insert_error_native_balances(account, message, tracker);
    }
}

export async function run(tracker?: ProgressTracker) {
    // Initialize service (must be called before using batch insert queue)
    initService({ serviceName: 'Native balances RPC service' });

    const queue = new PQueue({ concurrency: CONCURRENCY });

    const accounts = await get_accounts_for_native_balances();

    if (accounts.length > 0) {
        log.info('Found accounts to process', {
            count: accounts.length,
        });
    }

    if (VERBOSE) {
        console.log(`\n📋 Task Overview:`);
        console.log(`   Unique accounts: ${accounts.length}`);
        console.log(`   Total tasks to process: ${accounts.length}`);
        console.log(``);
    }

    // Initialize or reset progress tracker
    if (!tracker) {
        tracker = new ProgressTracker({
            serviceName: 'Native Balances',
            totalTasks: accounts.length,
            enablePrometheus: true,
            prometheusPort: PROMETHEUS_PORT,
        });
    } else {
        tracker.reset(accounts.length);
    }

    // Process all accounts
    for (const account of accounts) {
        queue.add(() => processNativeBalance(account, tracker!));
    }

    // Wait for all tasks to complete
    await queue.onIdle();
    // Always keep Prometheus alive for auto-restart
    await tracker.complete({ keepPrometheusAlive: true });

    // Shutdown batch insert queue
    if (VERBOSE) {
        console.log('⏳ Flushing remaining batch inserts...');
    }
    await shutdownBatchInsertQueue();
    if (VERBOSE) {
        console.log('✅ Batch inserts flushed successfully');
    }

    return tracker;
}

// Run the service if this is the main module
if (import.meta.main) {
    await run();
}
