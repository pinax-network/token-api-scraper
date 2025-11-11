import PQueue from 'p-queue';
import { callContract } from '../lib/rpc';
import { insert_error_metadata, insert_metadata } from '../src/insert';
import { get_contracts } from '../src/queries';
import { ProgressTracker } from '../lib/progress';

const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10', 10);
const ENABLE_PROMETHEUS = process.env.ENABLE_PROMETHEUS === 'true';
const PROMETHEUS_PORT = parseInt(process.env.PROMETHEUS_PORT || '9090', 10);

const queue = new PQueue({ concurrency: CONCURRENCY });

console.log(`🚀 Starting metadata RPC service with concurrency: ${CONCURRENCY}`);
if (ENABLE_PROMETHEUS) {
    console.log(`📊 Prometheus metrics enabled on port ${PROMETHEUS_PORT}`);
}

const contracts = await get_contracts();

const processContract = async (contract: string, tracker: ProgressTracker) => {
    try {
        // Fetch decimals (required)
        const decimals_hex = await callContract(contract, "decimals()"); // 313ce567

        // Fetch symbol & name only if decimals exists
        if (decimals_hex) {
            const symbol_hex = await callContract(contract, "symbol()"); // 95d89b41
            const name_hex = await callContract(contract, "name()"); // 06fdde03
            insert_metadata({
                contract,
                name_hex,
                symbol_hex,
                decimals_hex,
            });
            tracker.incrementSuccess();
        } else {
            insert_error_metadata(contract, "missing decimals()");
            tracker.incrementError();
        }

    } catch (err) {
        const message = (err as Error).message || String(err);
        insert_error_metadata(contract, message);
        tracker.incrementError();
    }
};

console.log(`\n📋 Task Overview:`);
console.log(`   Unique contracts: ${contracts.length}`);
console.log(`   Total tasks to process: ${contracts.length}`);
console.log(``);

// Initialize progress tracker
const tracker = new ProgressTracker({
    serviceName: 'Metadata',
    totalTasks: contracts.length,
    enablePrometheus: ENABLE_PROMETHEUS,
    prometheusPort: PROMETHEUS_PORT
});

// Add all contracts to the queue
for (const contract of contracts) {
    queue.add(() => processContract(contract, tracker));
}

// Wait for all tasks to complete
await queue.onIdle();
tracker.complete();
