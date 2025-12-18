import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { CONCURRENCY, PROMETHEUS_PORT, VERBOSE } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { ProgressTracker } from '../../lib/progress';
import { callContract } from '../../lib/rpc';
import { initService } from '../../lib/service-init';
import { insert_balances, insert_error_balances } from '../../src/insert';
import { get_latest_transfers } from '../../src/queries';

const log = createLogger('balances-erc20');

async function processBalanceOf(
    account: string,
    contract: string,
    block_num: number,
    tracker: ProgressTracker,
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
                tracker,
            );

            log.info('Balance scraped successfully', {
                contract,
                account,
                balanceHex: balance_hex,
                blockNum: block_num,
                queryTimeMs,
            });
        } else {
            await insert_error_balances(
                { block_num, contract, account },
                'zero balance',
                tracker,
            );
        }
    } catch (err) {
        const message = (err as Error).message || String(err);
        await insert_error_balances(
            { block_num, contract, account },
            message,
            tracker,
        );
    }
}

function isBlackHoleAddress(address: string): boolean {
    return address === 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
}

export async function run(tracker?: ProgressTracker) {
    // Initialize service (must be called before using batch insert queue)
    initService({ serviceName: 'ERC20 balances RPC service' });

    const queue = new PQueue({ concurrency: CONCURRENCY });

    const transfers = await get_latest_transfers();

    // Calculate total tasks and collect unique contracts
    const uniqueContracts = new Set<string>();
    const uniqueAccounts = new Set<string>();
    let totalTasks = 0;

    for (const { log_address, from, to } of transfers) {
        uniqueContracts.add(log_address);
        if (!isBlackHoleAddress(from)) {
            uniqueAccounts.add(from);
            totalTasks++;
        }
        uniqueAccounts.add(to);
        totalTasks++;
    }

    if (totalTasks > 0) {
        log.info('Found transfers to process', {
            uniqueContracts: uniqueContracts.size,
            uniqueAccounts: uniqueAccounts.size,
            totalTasks,
        });
    }

    if (VERBOSE) {
        console.log(`\n📋 Task Overview:`);
        console.log(`   Unique contracts: ${uniqueContracts.size}`);
        console.log(`   Unique accounts: ${uniqueAccounts.size}`);
        console.log(`   Total tasks to process: ${totalTasks}`);
        console.log(``);
    }

    // Initialize or reset progress tracker
    if (!tracker) {
        tracker = new ProgressTracker({
            serviceName: 'ERC20 Balances',
            totalTasks,
            enablePrometheus: true,
            prometheusPort: PROMETHEUS_PORT,
        });
    } else {
        tracker.reset(totalTasks);
    }

    // Process all accounts and their contracts
    for (const { log_address, from, to, block_num } of transfers) {
        if (!isBlackHoleAddress(from)) {
            queue.add(() =>
                processBalanceOf(from, log_address, block_num, tracker!),
            );
        }
        queue.add(() => processBalanceOf(to, log_address, block_num, tracker!));
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
