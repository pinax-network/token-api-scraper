import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import {
    CONCURRENCY,
    ENABLE_PROMETHEUS,
    PROMETHEUS_PORT,
    VERBOSE,
} from '../../lib/config';
import { ProgressTracker } from '../../lib/progress';
import { callContract } from '../../lib/rpc';
import { initService } from '../../lib/service-init';
import { insert_balances, insert_error_balances } from '../../src/insert';
import { get_latest_transfers } from '../../src/queries';

// Initialize service
initService({ serviceName: 'TRC20 balances RPC service' });

const queue = new PQueue({ concurrency: CONCURRENCY });

const transfers = await get_latest_transfers();

async function processBalanceOf(
    account: string,
    contract: string,
    block_num: number,
    tracker: ProgressTracker,
) {
    // get `balanceOf` RPC call for the account
    try {
        const balance_hex = await callContract(contract, `balanceOf(address)`, [
            account,
        ]); // 70a08231

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

if (VERBOSE) {
    console.log(`\n📋 Task Overview:`);
    console.log(`   Unique contracts: ${uniqueContracts.size}`);
    console.log(`   Unique accounts: ${uniqueAccounts.size}`);
    console.log(`   Total tasks to process: ${totalTasks}`);
    console.log(``);
}

// Initialize progress tracker
const tracker = new ProgressTracker({
    serviceName: 'ERC20 Balances',
    totalTasks,
    enablePrometheus: ENABLE_PROMETHEUS,
    prometheusPort: PROMETHEUS_PORT,
});

// Process all accounts and their contracts
for (const { log_address, from, to, block_num } of transfers) {
    if (!isBlackHoleAddress(from)) {
        queue.add(() =>
            processBalanceOf(from, log_address, block_num, tracker),
        );
    }
    queue.add(() => processBalanceOf(to, log_address, block_num, tracker));
}

// Wait for all tasks to complete
await queue.onIdle();
tracker.complete();

// Shutdown batch insert queue
if (VERBOSE) {
    console.log('⏳ Flushing remaining batch inserts...');
}
await shutdownBatchInsertQueue();
if (VERBOSE) {
    console.log('✅ Batch inserts flushed successfully');
}
