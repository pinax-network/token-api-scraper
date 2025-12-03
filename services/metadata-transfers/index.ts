import PQueue from 'p-queue';
import { callContract } from '../../lib/rpc';
import { insert_error_metadata, insert_metadata } from '../../src/insert';
import { ProgressTracker } from '../../lib/progress';
import { CONCURRENCY, ENABLE_PROMETHEUS, PROMETHEUS_PORT } from '../../lib/config';
import { query } from '../../lib/clickhouse';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { initService } from '../../lib/service-init';

// Initialize service
initService({ serviceName: 'metadata RPC service' });

const queue = new PQueue({ concurrency: CONCURRENCY });

const contracts = await query<{ contract: string, block_num: number }>(
    await Bun.file(__dirname + "/get_contracts_by_transfers.sql").text()
);

async function processMetadata(contract: string, block_num: number, tracker: ProgressTracker) {
    try {
        // Fetch decimals (required)
        const decimals_hex = await callContract(contract, "decimals()"); // 313ce567

        // Fetch symbol & name only if decimals exists
        if (decimals_hex) {
            const symbol_hex = await callContract(contract, "symbol()"); // 95d89b41
            const name_hex = await callContract(contract, "name()"); // 06fdde03
            await insert_metadata({
                contract,
                block_num,
                name_hex,
                symbol_hex,
                decimals_hex,
            }, tracker);
        } else {
            await insert_error_metadata({contract, block_num}, "missing decimals()", tracker);
        }

    } catch (err) {
        const message = (err as Error).message || String(err);
        await insert_error_metadata({contract, block_num}, message, tracker);
    }
};

console.log(`\n📋 Task Overview:`);
console.log(`   Unique contracts by transfers: ${contracts.data.length}`);
console.log(``);

// Initialize progress tracker
const tracker = new ProgressTracker({
    serviceName: 'Metadata',
    totalTasks: contracts.data.length,
    enablePrometheus: ENABLE_PROMETHEUS,
    prometheusPort: PROMETHEUS_PORT
});

// Single request mode (default)
for (const {contract, block_num} of contracts.data) {
    queue.add(() => processMetadata(contract, block_num, tracker));
}

// Wait for all tasks to complete
await queue.onIdle();
tracker.complete();

// Shutdown batch insert queue
console.log('⏳ Flushing remaining batch inserts...');
await shutdownBatchInsertQueue();
console.log('✅ Batch inserts flushed successfully');
