import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { query } from '../../lib/clickhouse';
import { createLogger } from '../../lib/logger';
import { ProcessingStats } from '../../lib/processing-stats';
import { incrementError, incrementSuccess } from '../../lib/prometheus';
import { initService } from '../../lib/service-init';
import { insertRow } from '../../src/insert';

const serviceName = 'forked-blocks';
const log = createLogger(serviceName);

/**
 * Interface for forked block data from the query
 */
interface ForkedBlock {
    block_num: number;
    block_hash: string;
    parent_hash: string;
    timestamp: string;
}

/**
 * Insert a forked block into the blocks_forked table
 */
async function insertForkedBlock(
    block: ForkedBlock,
    serviceName: string,
    stats: ProcessingStats,
): Promise<void> {
    const success = await insertRow(
        'blocks_forked',
        {
            block_num: block.block_num,
            block_hash: block.block_hash,
            parent_hash: block.parent_hash,
            timestamp: block.timestamp,
        },
        `Failed to insert forked block ${block.block_hash}`,
        {},
    );
    if (success) {
        incrementSuccess(serviceName);
        stats.incrementSuccess();
    } else {
        incrementError(serviceName);
        stats.incrementError();
    }
}

/**
 * Calculate the since_date based on the number of days to look back
 * Default is 30 days
 */
function calculateSinceDate(daysBack: number = 30): string {
    const date = new Date();
    date.setDate(date.getDate() - daysBack);
    return date.toISOString().split('T')[0];
}

/**
 * Main run function for the forked blocks service
 * Queries for blocks that exist in the source database but not in the canonical blocks database
 */
export async function run(): Promise<void> {
    // Initialize service (must be called before using batch insert queue)
    initService({ serviceName });

    // Track processing stats for summary logging
    const stats = new ProcessingStats(serviceName);

    // Get configuration from environment variables
    const clickhouseBlocksDatabase = process.env.CLICKHOUSE_BLOCKS_DATABASE;
    const clickhouseDatabase = process.env.CLICKHOUSE_DATABASE;
    const daysBack = parseInt(process.env.FORKED_BLOCKS_DAYS_BACK || '30', 10);

    // Validate required environment variables
    if (!clickhouseBlocksDatabase) {
        log.error(
            'CLICKHOUSE_BLOCKS_DATABASE environment variable is required',
        );
        throw new Error(
            'CLICKHOUSE_BLOCKS_DATABASE environment variable is required',
        );
    }

    if (!clickhouseDatabase) {
        log.error('CLICKHOUSE_DATABASE environment variable is required');
        throw new Error('CLICKHOUSE_DATABASE environment variable is required');
    }

    const sinceDate = calculateSinceDate(daysBack);

    log.info('Starting forked blocks detection', {
        clickhouseBlocksDatabase,
        clickhouseDatabase,
        sinceDate,
        daysBack,
    });

    // Load and execute the SQL query
    const sql = await Bun.file(__dirname + '/get_forked_blocks.sql').text();

    const result = await query<ForkedBlock>(sql, {
        canonical_database: clickhouseBlocksDatabase,
        source_database: clickhouseDatabase,
        since_date: sinceDate,
    });

    if (result.data.length === 0) {
        log.info('No forked blocks found');
    } else {
        log.info('Found forked blocks', {
            count: result.data.length,
        });

        // Insert all forked blocks
        for (const block of result.data) {
            await insertForkedBlock(block, serviceName, stats);
            log.debug('Inserted forked block', {
                blockNum: block.block_num,
                blockHash: block.block_hash,
            });
        }

        log.info('Forked blocks inserted successfully', {
            count: result.data.length,
        });
    }

    stats.logCompletion();

    // Shutdown batch insert queue
    await shutdownBatchInsertQueue();
}

// Run the service if this is the main module
if (import.meta.main) {
    await run();
}
