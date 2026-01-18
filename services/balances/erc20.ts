import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { CONCURRENCY } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { callContract } from '../../lib/rpc';
import { initService } from '../../lib/service-init';
import { insert_balances, insert_error_balances } from '../../src/insert';
import { get_latest_transfers } from '../../src/queries';

const serviceName = 'balances-erc20';
const log = createLogger(serviceName);

/**
 * Counter object for tracking success and error counts
 * Using an object reference allows safe updates in async callbacks within a single-threaded event loop
 */
interface ProcessingStats {
    successCount: number;
    errorCount: number;
}

async function processBalanceOf(
    account: string,
    contract: string,
    block_num: number,
    stats: ProcessingStats,
) {
    // get `balanceOf` RPC call for the account
    const startTime = performance.now();
    try {
        const balance_hex = await callContract(contract, `balanceOf(address)`, [
            account,
        ]); // 70a08231
        const queryTimeMs = Math.round(performance.now() - startTime);

        if (balance_hex) {
            await insert_balances(
                {
                    account,
                    contract,
                    balance_hex,
                    block_num,
                },
                serviceName,
            );

            stats.successCount++;
            log.debug('Balance scraped successfully', {
                contract,
                account,
                balanceHex: balance_hex,
                blockNum: block_num,
                queryTimeMs,
            });
        } else {
            stats.errorCount++;
            await insert_error_balances(
                { block_num, contract, account },
                'zero balance',
                serviceName,
            );
        }
    } catch (err) {
        stats.errorCount++;
        const message = (err as Error).message || String(err);

        // Emit warning for RPC errors with context
        log.warn('Balance RPC call failed - non-deterministic error', {
            contract,
            account,
            blockNum: block_num,
            error: message,
            serviceName,
        });

        await insert_error_balances(
            { block_num, contract, account },
            message,
            serviceName,
        );
    }
}

function isBlackHoleAddress(address: string): boolean {
    return address === 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
}

export async function run() {
    // Initialize service (must be called before using batch insert queue)
    initService({ serviceName: 'ERC20 balances RPC service' });

    // Track processing stats for summary logging
    const stats: ProcessingStats = { successCount: 0, errorCount: 0 };

    const queue = new PQueue({ concurrency: CONCURRENCY });

    const transfers = await get_latest_transfers();

    if (transfers.length > 0) {
        log.info('Processing balances from transfers', {
            transferCount: transfers.length,
        });
    } else {
        log.info('No transfers to process');
    }

    // Process all accounts and their contracts
    for (const { log_address, from, to, block_num } of transfers) {
        if (!isBlackHoleAddress(from)) {
            queue.add(async () => {
                await processBalanceOf(from, log_address, block_num, stats);
            });
        }
        queue.add(async () => {
            await processBalanceOf(to, log_address, block_num, stats);
        });
    }

    // Wait for all tasks to complete
    await queue.onIdle();

    log.info('Service completed', {
        successCount: stats.successCount,
        errorCount: stats.errorCount,
        totalProcessed: stats.successCount + stats.errorCount,
    });

    // Shutdown batch insert queue
    await shutdownBatchInsertQueue();
}

// Run the service if this is the main module
if (import.meta.main) {
    await run();
}
