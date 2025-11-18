import { client } from './clickhouse';

/**
 * Interface for batch insert configuration
 */
export interface BatchInsertConfig {
    /** Enable batch insert mechanism (default: false) */
    enabled: boolean;
    /** Interval in milliseconds to flush batches (default: 1000ms) */
    intervalMs: number;
    /** Maximum number of rows before forcing a flush (default: 10000) */
    maxSize: number;
}

/**
 * Interface for items in the batch queue
 */
interface BatchItem<T> {
    table: string;
    value: T;
}

/**
 * BatchInsertQueue manages batched inserts to ClickHouse
 * Accumulates inserts and flushes them either:
 * - Every intervalMs milliseconds
 * - When the batch reaches maxSize rows
 */
export class BatchInsertQueue {
    private queues: Map<string, any[]> = new Map();
    private timer: Timer | null = null;
    private config: BatchInsertConfig;
    private isShuttingDown = false;

    constructor(config: BatchInsertConfig) {
        this.config = config;
        
        if (this.config.enabled) {
            this.startTimer();
        }
    }

    /**
     * Add a row to the batch queue for a specific table
     */
    public async add<T>(table: string, value: T): Promise<void> {
        if (!this.config.enabled) {
            // If batching is disabled, insert immediately
            await this.insertImmediate(table, [value]);
            return;
        }

        // Get or create queue for this table
        if (!this.queues.has(table)) {
            this.queues.set(table, []);
        }

        const queue = this.queues.get(table)!;
        queue.push(value);

        // Check if we've reached the max size for this table
        if (queue.length >= this.config.maxSize) {
            await this.flush(table);
        }
    }

    /**
     * Flush all pending inserts for a specific table
     */
    private async flush(table: string): Promise<void> {
        const queue = this.queues.get(table);
        if (!queue || queue.length === 0) {
            return;
        }

        // Get all items and clear the queue
        const items = queue.splice(0);

        try {
            await this.insertImmediate(table, items);
        } catch (error) {
            this.handleInsertError(error, table, items.length);
        }
    }

    /**
     * Flush all pending inserts for all tables
     */
    public async flushAll(): Promise<void> {
        const tables = Array.from(this.queues.keys());
        await Promise.all(tables.map(table => this.flush(table)));
    }

    /**
     * Insert values immediately into ClickHouse
     */
    private async insertImmediate<T>(table: string, values: T[]): Promise<void> {
        if (values.length === 0) {
            return;
        }

        await client.insert({
            table,
            format: 'JSONEachRow',
            values,
        });
    }

    /**
     * Start the timer for periodic flushes
     */
    private startTimer(): void {
        if (this.timer) {
            clearInterval(this.timer);
        }

        this.timer = setInterval(() => {
            if (!this.isShuttingDown) {
                this.flushAll().catch(error => {
                    console.error('Error during periodic flush:', error);
                });
            }
        }, this.config.intervalMs);
    }

    /**
     * Handle insert errors
     */
    private handleInsertError(error: unknown, table: string, count: number): void {
        const err = error as Error;
        const errorMessage = err?.message || String(error);
        console.error(`Failed to insert batch of ${count} rows into ${table}:`, errorMessage);
    }

    /**
     * Shutdown the batch insert queue
     * Flushes all pending inserts and stops the timer
     */
    public async shutdown(): Promise<void> {
        this.isShuttingDown = true;
        
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        await this.flushAll();
    }

    /**
     * Get the current queue size for a specific table
     */
    public getQueueSize(table: string): number {
        return this.queues.get(table)?.length || 0;
    }

    /**
     * Get the total queue size across all tables
     */
    public getTotalQueueSize(): number {
        let total = 0;
        for (const queue of this.queues.values()) {
            total += queue.length;
        }
        return total;
    }
}

// Global batch insert queue instance
let globalBatchQueue: BatchInsertQueue | null = null;

/**
 * Initialize the global batch insert queue
 */
export function initBatchInsertQueue(config: BatchInsertConfig): void {
    if (globalBatchQueue) {
        throw new Error('Batch insert queue already initialized');
    }
    globalBatchQueue = new BatchInsertQueue(config);
}

/**
 * Get the global batch insert queue instance
 */
export function getBatchInsertQueue(): BatchInsertQueue {
    if (!globalBatchQueue) {
        throw new Error('Batch insert queue not initialized. Call initBatchInsertQueue first.');
    }
    return globalBatchQueue;
}

/**
 * Shutdown the global batch insert queue
 */
export async function shutdownBatchInsertQueue(): Promise<void> {
    if (globalBatchQueue) {
        await globalBatchQueue.shutdown();
        globalBatchQueue = null;
    }
}
