import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { query } from '../../lib/clickhouse';
import {
    CONCURRENCY,
    NETWORK,
    PROMETHEUS_PORT,
} from '../../lib/config';
import { ProgressTracker } from '../../lib/progress';
import { initService } from '../../lib/service-init';
import { processMetadata } from '.';

export async function run(tracker?: ProgressTracker) {
    // Initialize service (must be called before using batch insert queue)
    initService({ serviceName: 'metadata RPC service' });

    const queue = new PQueue({ concurrency: CONCURRENCY });

    const contracts = await query<{ contract: string; block_num: number }>(
        await Bun.file(__dirname + '/get_contracts_by_swaps.sql').text(),
    );

    // Initialize or reset progress tracker
    if (!tracker) {
        tracker = new ProgressTracker({
            serviceName: 'Token Metadata by Swaps',
            totalTasks: contracts.data.length,
            enablePrometheus: true,
            prometheusPort: PROMETHEUS_PORT,
        });
    } else {
        tracker.reset(contracts.data.length);
    }

    // Single request mode (default)
    for (const { contract, block_num } of contracts.data) {
        queue.add(() =>
            processMetadata(NETWORK, contract, block_num, tracker!),
        );
    }

    // Wait for all tasks to complete
    await queue.onIdle();
    // Always keep Prometheus alive for auto-restart
    await tracker.complete({ keepPrometheusAlive: true });

    // Shutdown batch insert queue
    await shutdownBatchInsertQueue();

    return tracker;
}

// Run the service if this is the main module
if (import.meta.main) {
    await run();
}
