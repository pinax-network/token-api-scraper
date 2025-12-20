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

    // Process all accounts
    for (const account of accounts) {
        queue.add(async () => {
            await processNativeBalance(account);
        });
    }

    // Wait for all tasks to complete
    await queue.onIdle();

    log.info('Service completed');

    // Shutdown batch insert queue
    await shutdownBatchInsertQueue();
}

// Run the service if this is the main module
if (import.meta.main) {
    await run();
}
