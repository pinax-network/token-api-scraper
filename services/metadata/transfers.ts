import PQueue from 'p-queue';
import { ProgressTracker } from '../../lib/progress';
import { CONCURRENCY, ENABLE_PROMETHEUS, PROMETHEUS_PORT, NETWORK } from '../../lib/config';
import { query } from '../../lib/clickhouse';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { initService } from '../../lib/service-init';
import { processMetadata } from '.';

// Initialize service
initService({ serviceName: 'metadata RPC service' });

const queue = new PQueue({ concurrency: CONCURRENCY });

const contracts = await query<{ contract: string, block_num: number }>(
    await Bun.file(__dirname + "/get_contracts_by_transfers.sql").text()
);

// Initialize progress tracker
const tracker = new ProgressTracker({
    serviceName: 'Token Metadata by Transfers',
    totalTasks: contracts.data.length,
    enablePrometheus: ENABLE_PROMETHEUS,
    prometheusPort: PROMETHEUS_PORT
});

// Single request mode (default)
for (const { contract, block_num } of contracts.data) {
    queue.add(() => processMetadata(NETWORK, contract, block_num, tracker));
}

// Wait for all tasks to complete
await queue.onIdle();
tracker.complete();

// Shutdown batch insert queue
await shutdownBatchInsertQueue();
