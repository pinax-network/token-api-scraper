import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { CONCURRENCY } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { getNativeBalance } from '../../lib/rpc';
import { initService } from '../../lib/service-init';
import {
    insert_error_native_balances,
    insert_native_balances,
} from '../../src/insert';
import { get_accounts_for_native_balances } from '../../src/queries';

const serviceName = 'balances-native';
const log = createLogger(serviceName);

// Track success and error counts for summary logging
let successCount = 0;
let errorCount = 0;

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
            serviceName,
        );

        successCount++;
        log.debug('Native balance scraped successfully', {
            account,
            balanceHex: balance_hex,
            queryTimeMs,
        });
    } catch (err) {
        errorCount++;
        const message = (err as Error).message || String(err);

        // Emit warning for RPC errors with context
        log.warn('Native balance RPC call failed - non-deterministic error', {
            account,
            error: message,
            serviceName,
        });

        await insert_error_native_balances(account, message, serviceName);
    }
}

export async function run() {
    // Initialize service (must be called before using batch insert queue)
    initService({ serviceName: 'Native balances RPC service' });

    // Reset counters for this run
    successCount = 0;
    errorCount = 0;

    const queue = new PQueue({ concurrency: CONCURRENCY });

    const accounts = await get_accounts_for_native_balances();

    if (accounts.length > 0) {
        log.info('Processing native balances', {
            accountCount: accounts.length,
        });
    } else {
        log.info('No accounts to process');
    }

    // Process all accounts
    for (const account of accounts) {
        queue.add(async () => {
            await processNativeBalance(account);
        });
    }

    // Wait for all tasks to complete
    await queue.onIdle();

    log.info('Service completed', {
        successCount,
        errorCount,
        totalProcessed: successCount + errorCount,
    });

    // Shutdown batch insert queue
    await shutdownBatchInsertQueue();
}

// Run the service if this is the main module
if (import.meta.main) {
    await run();
}
