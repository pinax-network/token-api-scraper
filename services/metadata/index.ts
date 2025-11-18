import PQueue from 'p-queue';
import { callContract, batchCallContracts, ContractCallRequest } from '../../lib/rpc';
import { insert_error_metadata, insert_metadata } from '../../src/insert';
import { ProgressTracker } from '../../lib/progress';
import { CONCURRENCY, ENABLE_PROMETHEUS, PROMETHEUS_PORT, BATCH_INSERT_INTERVAL_MS, BATCH_INSERT_MAX_SIZE } from '../../lib/config';
import { CONCURRENCY, ENABLE_PROMETHEUS, PROMETHEUS_PORT, BATCH_INSERT_ENABLED, BATCH_INSERT_INTERVAL_MS, BATCH_INSERT_MAX_SIZE, RPC_BATCH_ENABLED, RPC_BATCH_SIZE } from '../../lib/config';
import { query } from '../../lib/clickhouse';
import { initBatchInsertQueue, shutdownBatchInsertQueue } from '../../lib/batch-insert';

const queue = new PQueue({ concurrency: CONCURRENCY });

// Initialize batch insert queue
initBatchInsertQueue({
    intervalMs: BATCH_INSERT_INTERVAL_MS,
    maxSize: BATCH_INSERT_MAX_SIZE,
});
console.log(`⚡ Batch insert enabled: flush every ${BATCH_INSERT_INTERVAL_MS}ms or ${BATCH_INSERT_MAX_SIZE} rows`);

console.log(`🚀 Starting metadata RPC service with concurrency: ${CONCURRENCY}`);
if (ENABLE_PROMETHEUS) {
    console.log(`📊 Prometheus metrics enabled on port ${PROMETHEUS_PORT}`);
}
if (RPC_BATCH_ENABLED) {
    console.log(`⚡ RPC batch requests enabled with batch size: ${RPC_BATCH_SIZE}`);
}

const contracts_by_transfers = await query<{ contract: string, block_num: number }>(
    await Bun.file(__dirname + "/get_contracts_by_transfers.sql").text()
);
const contracts_by_swaps = await query<{ contract: string, block_num: number }>(
    await Bun.file(__dirname + "/get_contracts_by_swaps.sql").text()
);
const contracts = contracts_by_transfers.data.concat(contracts_by_swaps.data);

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
            });
            tracker.incrementSuccess();
        } else {
            await insert_error_metadata({contract, block_num}, "missing decimals()");
            tracker.incrementError();
        }

    } catch (err) {
        const message = (err as Error).message || String(err);
        await insert_error_metadata({contract, block_num}, message);
        tracker.incrementError();
    }
};

async function processMetadataBatch(contractItems: Array<{ contract: string, block_num: number }>, tracker: ProgressTracker) {
    try {
        // Build batch request for all contracts
        const batchCalls: ContractCallRequest[] = [];
        for (const { contract } of contractItems) {
            batchCalls.push(
                { contract, signature: "decimals()" },
                { contract, signature: "symbol()" },
                { contract, signature: "name()" }
            );
        }

        // Execute batch call
        const results = await batchCallContracts(batchCalls);

        // Process results (3 results per contract)
        for (let i = 0; i < contractItems.length; i++) {
            const { contract, block_num } = contractItems[i];
            const decimalsResult = results[i * 3];
            const symbolResult = results[i * 3 + 1];
            const nameResult = results[i * 3 + 2];

            try {
                // Check if decimals call succeeded
                if (decimalsResult.success && decimalsResult.result) {
                    // Check if symbol and name calls succeeded
                    if (symbolResult.success && nameResult.success) {
                        await insert_metadata({
                            contract,
                            block_num,
                            name_hex: nameResult.result || "",
                            symbol_hex: symbolResult.result || "",
                            decimals_hex: decimalsResult.result,
                        });
                        tracker.incrementSuccess();
                    } else {
                        // One of symbol/name failed
                        const errorMsg = !symbolResult.success 
                            ? `symbol() failed: ${symbolResult.error}` 
                            : `name() failed: ${nameResult.error}`;
                        await insert_error_metadata({contract, block_num}, errorMsg);
                        tracker.incrementError();
                    }
                } else {
                    // Decimals failed
                    const errorMsg = decimalsResult.success 
                        ? "missing decimals()" 
                        : `decimals() failed: ${decimalsResult.error}`;
                    await insert_error_metadata({contract, block_num}, errorMsg);
                    tracker.incrementError();
                }
            } catch (err) {
                const message = (err as Error).message || String(err);
                await insert_error_metadata({contract, block_num}, message);
                tracker.incrementError();
            }
        }

    } catch (err) {
        // If batch call itself fails, mark all contracts as errors
        const message = (err as Error).message || String(err);
        for (const { contract, block_num } of contractItems) {
            await insert_error_metadata({contract, block_num}, `Batch call failed: ${message}`);
            tracker.incrementError();
        }
    }
};

console.log(`\n📋 Task Overview:`);
console.log(`   Unique contracts by transfers: ${contracts_by_transfers.data.length}`);
console.log(`   Unique contracts by swaps: ${contracts_by_swaps.data.length}`);
console.log(`   Total tasks to process: ${contracts_by_transfers.data.length + contracts_by_swaps.data.length}`);
console.log(``);

// Initialize progress tracker
const tracker = new ProgressTracker({
    serviceName: 'Metadata',
    totalTasks: contracts.length,
    enablePrometheus: ENABLE_PROMETHEUS,
    prometheusPort: PROMETHEUS_PORT
});

// Process contracts with or without batching
if (RPC_BATCH_ENABLED) {
    // Batch processing mode
    console.log(`⚡ Using batch processing mode`);
    
    // Group contracts into batches
    for (let i = 0; i < contracts.length; i += RPC_BATCH_SIZE) {
        const batch = contracts.slice(i, i + RPC_BATCH_SIZE);
        queue.add(() => processMetadataBatch(batch, tracker));
    }
} else {
    // Single request mode (default)
    for (const {contract, block_num} of contracts) {
        queue.add(() => processMetadata(contract, block_num, tracker));
    }
}

// Wait for all tasks to complete
await queue.onIdle();
tracker.complete();

// Shutdown batch insert queue
console.log('⏳ Flushing remaining batch inserts...');
await shutdownBatchInsertQueue();
console.log('✅ Batch inserts flushed successfully');
