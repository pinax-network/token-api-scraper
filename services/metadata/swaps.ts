import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { query } from '../../lib/clickhouse';
import { CONCURRENCY, NETWORK } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { setProgress, setTotalTasks } from '../../lib/prometheus';
import { initService } from '../../lib/service-init';
import { processMetadata } from '.';

const log = createLogger('metadata-swaps');
const SERVICE_NAME = 'Token Metadata by Swaps';

export async function run() {
    // Initialize service (must be called before using batch insert queue)
    initService({ serviceName: 'metadata RPC service' });

    const queue = new PQueue({ concurrency: CONCURRENCY });

    const contracts = await query<{ contract: string; block_num: number }>(
        await Bun.file(__dirname + '/get_contracts_by_swaps.sql').text(),
    );

    log.info('Found contracts to scrape', {
        count: contracts.data.length,
        blockNum: contracts.data?.[0]?.block_num ?? 'N/A',
        source: 'swaps',
    });

    // Set total tasks for Prometheus
    setTotalTasks(SERVICE_NAME, contracts.data.length);
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
        const currentProgress = Math.floor(
            (completedTasks / contracts.data.length) * 100,
        );
        if (
            currentProgress !== lastReportedProgress &&
            (completedTasks % 10 === 0 ||
                completedTasks === contracts.data.length)
        ) {
            lastReportedProgress = currentProgress;
            setProgress(SERVICE_NAME, currentProgress);
        }
    };

    // Process all contracts
    for (const { contract, block_num } of contracts.data) {
        queue.add(async () => {
            await processMetadata(NETWORK, contract, block_num, SERVICE_NAME);
            updateProgress();
        });
    }

    // Wait for all tasks to complete
    await queue.onIdle();

    const elapsed = (Date.now() - startTime) / 1000;
    const rate = elapsed > 0 ? completedTasks / elapsed : 0;

    log.info('Service completed', {
        totalTasks: contracts.data.length,
        completedTasks,
        elapsedSeconds: elapsed.toFixed(2),
        avgRate: rate.toFixed(2),
    });

    // Shutdown batch insert queue
    await shutdownBatchInsertQueue();
}

// Run the service if this is the main module
if (import.meta.main) {
    await run();
}
