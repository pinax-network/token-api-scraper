import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { BatchInsertQueue } from './batch-insert';

// Mock the clickhouse client
const mockInsert = mock(() => Promise.resolve());
mock.module('./clickhouse', () => ({
    client: {
        insert: mockInsert,
    },
}));

describe('BatchInsertQueue', () => {
    let queue: BatchInsertQueue;

    afterEach(async () => {
        if (queue) {
            await queue.shutdown();
        }
        mockInsert.mockClear();
    });

    describe('batch mode', () => {
        beforeEach(() => {
            queue = new BatchInsertQueue({
                intervalMs: 1000,
                maxSize: 10000,
            });
        });

        test('should queue items without immediate insert', async () => {
            await queue.add('test_table', { id: 1, value: 'test' });
            
            expect(mockInsert).not.toHaveBeenCalled();
            expect(queue.getQueueSize('test_table')).toBe(1);
        });

        test('should accumulate multiple items in queue', async () => {
            await queue.add('test_table', { id: 1, value: 'test1' });
            await queue.add('test_table', { id: 2, value: 'test2' });
            await queue.add('test_table', { id: 3, value: 'test3' });
            
            expect(mockInsert).not.toHaveBeenCalled();
            expect(queue.getQueueSize('test_table')).toBe(3);
        });

        test('should flush when max size is reached', async () => {
            const smallQueue = new BatchInsertQueue({
                intervalMs: 1000,
                maxSize: 3,
            });

            await smallQueue.add('test_table', { id: 1 });
            await smallQueue.add('test_table', { id: 2 });
            await smallQueue.add('test_table', { id: 3 });
            
            expect(mockInsert).toHaveBeenCalledTimes(1);
            expect(mockInsert).toHaveBeenCalledWith({
                table: 'test_table',
                format: 'JSONEachRow',
                values: [{ id: 1 }, { id: 2 }, { id: 3 }],
            });

            await smallQueue.shutdown();
        });

        test('should flush all pending items on manual flushAll', async () => {
            await queue.add('test_table', { id: 1 });
            await queue.add('test_table', { id: 2 });
            
            await queue.flushAll();
            
            expect(mockInsert).toHaveBeenCalledTimes(1);
            expect(mockInsert).toHaveBeenCalledWith({
                table: 'test_table',
                format: 'JSONEachRow',
                values: [{ id: 1 }, { id: 2 }],
            });
            expect(queue.getQueueSize('test_table')).toBe(0);
        });

        test('should handle multiple tables independently', async () => {
            await queue.add('table1', { id: 1 });
            await queue.add('table2', { id: 2 });
            await queue.add('table1', { id: 3 });
            
            expect(queue.getQueueSize('table1')).toBe(2);
            expect(queue.getQueueSize('table2')).toBe(1);
            expect(queue.getTotalQueueSize()).toBe(3);
        });

        test('should flush all tables on flushAll', async () => {
            await queue.add('table1', { id: 1 });
            await queue.add('table2', { id: 2 });
            
            await queue.flushAll();
            
            expect(mockInsert).toHaveBeenCalledTimes(2);
            expect(queue.getTotalQueueSize()).toBe(0);
        });

        test('should flush on shutdown', async () => {
            await queue.add('test_table', { id: 1 });
            await queue.add('test_table', { id: 2 });
            
            await queue.shutdown();
            
            expect(mockInsert).toHaveBeenCalledTimes(1);
            expect(queue.getQueueSize('test_table')).toBe(0);
        });

        test('should flush periodically after interval', async () => {
            const fastQueue = new BatchInsertQueue({
                intervalMs: 100, // 100ms for faster test
                maxSize: 10000,
            });

            await fastQueue.add('test_table', { id: 1 });
            await fastQueue.add('test_table', { id: 2 });
            
            // Wait for the interval to trigger
            await new Promise(resolve => setTimeout(resolve, 150));
            
            expect(mockInsert).toHaveBeenCalled();
            
            await fastQueue.shutdown();
        });

        test('should return 0 for non-existent table queue size', () => {
            expect(queue.getQueueSize('non_existent_table')).toBe(0);
        });

        test('should handle empty flush gracefully', async () => {
            await queue.flushAll();
            expect(mockInsert).not.toHaveBeenCalled();
        });
    });

    describe('configuration', () => {
        test('should accept custom interval', () => {
            const customQueue = new BatchInsertQueue({
                intervalMs: 5000,
                maxSize: 10000,
            });
            expect(customQueue).toBeDefined();
            customQueue.shutdown();
        });

        test('should accept custom max size', () => {
            const customQueue = new BatchInsertQueue({
                intervalMs: 1000,
                maxSize: 500,
            });
            expect(customQueue).toBeDefined();
            customQueue.shutdown();
        });
    });

    describe('error handling', () => {
        test('should handle insert errors gracefully', async () => {
            mockInsert.mockRejectedValueOnce(new Error('Insert failed'));
            
            const errorQueue = new BatchInsertQueue({
                intervalMs: 1000,
                maxSize: 2,
            });

            // This should trigger a flush due to max size
            await errorQueue.add('test_table', { id: 1 });
            await errorQueue.add('test_table', { id: 2 });
            
            // Wait a bit to ensure the flush completes
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Should have attempted the insert
            expect(mockInsert).toHaveBeenCalled();
            
            await errorQueue.shutdown();
        });
    });
});

describe('batch insert configuration validation', () => {
    test('should accept valid configuration', () => {
        const queue = new BatchInsertQueue({
            intervalMs: 1000,
            maxSize: 10000,
        });
        expect(queue).toBeDefined();
        queue.shutdown();
    });

    test('should work with minimum values', () => {
        const queue = new BatchInsertQueue({
            intervalMs: 1,
            maxSize: 1,
        });
        expect(queue).toBeDefined();
        queue.shutdown();
    });

    test('should work with large values', () => {
        const queue = new BatchInsertQueue({
            intervalMs: 60000,
            maxSize: 100000,
        });
        expect(queue).toBeDefined();
        queue.shutdown();
    });
});
