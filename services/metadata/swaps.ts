import PQueue from 'p-queue';
import { ProgressTracker } from '../../lib/progress';
import { CONCURRENCY, ENABLE_PROMETHEUS, PROMETHEUS_PORT, VERBOSE } from '../../lib/config';
import { query } from '../../lib/clickhouse';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { initService } from '../../lib/service-init';
import { processMetadata } from '.';

// Initialize service
initService({ serviceName: 'metadata RPC service' });

const queue = new PQueue({ concurrency: CONCURRENCY });

const contracts = await query<{ contract: string, block_num: number }>(
    await Bun.file(__dirname + "/get_contracts_by_swaps.sql").text()
);
const network = process.env.CLICKHOUSE_DATABASE?.split(":")[0] || '';
if (!network) {
    throw new Error("CLICKHOUSE_DATABASE environment variable is not set properly.");
}

if (VERBOSE) {
    console.log(`\n🌐 Processing metadata for network: ${network}`);
    console.log(`\n📋 Task Overview:`);
    console.log(`   Unique contracts by transfers: ${contracts.data.length}`);
    console.log(``);
}

// Initialize progress tracker
const tracker = new ProgressTracker({
    serviceName: 'Metadata Swaps',
    totalTasks: contracts.data.length,
    enablePrometheus: ENABLE_PROMETHEUS,
    prometheusPort: PROMETHEUS_PORT
});

// Single request mode (default)
for (const { contract, block_num } of contracts.data) {
    queue.add(() => processMetadata(network, contract, block_num, tracker));
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
