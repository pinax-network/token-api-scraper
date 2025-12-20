import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { CONCURRENCY, VERBOSE } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { setProgress, setTotalTasks } from '../../lib/prometheus';
import { callContract } from '../../lib/rpc';
import { initService } from '../../lib/service-init';
import { insert_balances, insert_error_balances } from '../../src/insert';
import { get_latest_transfers } from '../../src/queries';

const log = createLogger('balances-erc20');
const SERVICE_NAME = 'ERC20 Balances';

async function processBalanceOf(
    account: string,
    contract: string,
    block_num: number,
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
                SERVICE_NAME,
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
                SERVICE_NAME,
            );
        }
    } catch (err) {
        const message = (err as Error).message || String(err);
        await insert_error_balances(
            { block_num, contract, account },
            message,
            SERVICE_NAME,
        );
    }
}

function isBlackHoleAddress(address: string): boolean {
    return address === 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
}

export async function run() {
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

    // Set total tasks for Prometheus
    setTotalTasks(SERVICE_NAME, totalTasks);
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
        const currentProgress = Math.floor((completedTasks / totalTasks) * 100);
        if (
            currentProgress !== lastReportedProgress &&
            (completedTasks % 10 === 0 || completedTasks === totalTasks)
        ) {
            lastReportedProgress = currentProgress;
            setProgress(SERVICE_NAME, currentProgress);
        }
    };

    // Process all accounts and their contracts
    for (const { log_address, from, to, block_num } of transfers) {
        if (!isBlackHoleAddress(from)) {
            queue.add(async () => {
                await processBalanceOf(from, log_address, block_num);
                updateProgress();
            });
        }
        queue.add(async () => {
            await processBalanceOf(to, log_address, block_num);
            updateProgress();
        });
    }

    // Wait for all tasks to complete
    await queue.onIdle();

    const elapsed = (Date.now() - startTime) / 1000;
    const rate = elapsed > 0 ? completedTasks / elapsed : 0;

    log.info('Service completed', {
        totalTasks,
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
