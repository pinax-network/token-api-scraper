import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { CONCURRENCY, VERBOSE } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { setProgress, setTotalTasks } from '../../lib/prometheus';
import { getNativeBalance } from '../../lib/rpc';
import { initService } from '../../lib/service-init';
import {
    insert_error_native_balances,
    insert_native_balances,
} from '../../src/insert';
import { get_accounts_for_native_balances } from '../../src/queries';

const log = createLogger('balances-native');
const SERVICE_NAME = 'Native Balances';

async function processNativeBalance(account: string) {
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
            SERVICE_NAME,
        );

        log.info('Native balance scraped successfully', {
            account,
            balanceHex: balance_hex,
            queryTimeMs,
        });
    } catch (err) {
        const message = (err as Error).message || String(err);
        await insert_error_native_balances(account, message, SERVICE_NAME);
    }
}

export async function run() {
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

    // Set total tasks for Prometheus
    setTotalTasks(SERVICE_NAME, accounts.length);
    setProgress(SERVICE_NAME, 0);

    let completedTasks = 0;
    const startTime = Date.now();

    // Track progress updates to avoid excessive Prometheus updates
    let lastReportedProgress = 0;

    // Helper to update progress periodically
    const updateProgress = () => {
        completedTasks++;
        // Update progress every 10 tasks or at completion
        // Note: completedTasks++ is safe in Node.js despite concurrent execution
        // because JavaScript is single-threaded. The modulo check is best-effort.
        const currentProgress = Math.floor(
            (completedTasks / accounts.length) * 100,
        );
        if (
            currentProgress !== lastReportedProgress &&
            (completedTasks % 10 === 0 || completedTasks === accounts.length)
        ) {
            lastReportedProgress = currentProgress;
            setProgress(SERVICE_NAME, currentProgress);
        }
    };

    // Process all accounts
    for (const account of accounts) {
        queue.add(async () => {
            await processNativeBalance(account);
            updateProgress();
        });
    }

    // Wait for all tasks to complete
    await queue.onIdle();

    const elapsed = (Date.now() - startTime) / 1000;
    const rate = elapsed > 0 ? completedTasks / elapsed : 0;

    log.info('Service completed', {
        totalTasks: accounts.length,
        completedTasks,
        elapsedSeconds: elapsed.toFixed(2),
        avgRate: rate.toFixed(2),
    });

    // Shutdown batch insert queue
    if (VERBOSE) {
        console.log('⏳ Flushing remaining batch inserts...');
    }
    await shutdownBatchInsertQueue();
    if (VERBOSE) {
        console.log('✅ Batch inserts flushed successfully');
    }
}

// Run the service if this is the main module
if (import.meta.main) {
    await run();
}
