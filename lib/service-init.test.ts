import { beforeEach, describe, expect, mock, test } from 'bun:test';

// Set log type to hidden to suppress output during tests
process.env.LOG_TYPE = 'hidden';

// Mock the batch-insert module
const mockInitBatchInsertQueue = mock(() => {});
mock.module('./batch-insert', () => ({
    initBatchInsertQueue: mockInitBatchInsertQueue,
}));

// Now import after setting environment and mocking
import { initService } from './service-init';

describe('initService', () => {
    beforeEach(() => {
        // Clear mock calls before each test
        mockInitBatchInsertQueue.mockClear();
    });

    test('should initialize service with provided name', () => {
        // This test just verifies the function can be called without errors
        expect(() => initService({ serviceName: 'Test Service 1' })).not.toThrow();
    });

    test('should initialize batch insert queue with correct config', () => {
        initService({ serviceName: 'Metadata Service' });

        // Verify that batch insert queue was initialized
        expect(mockInitBatchInsertQueue).toHaveBeenCalled();
        
        // Check the configuration passed to batch insert
        expect(mockInitBatchInsertQueue).toHaveBeenCalledWith({
            intervalMs: expect.any(Number),
            maxSize: expect.any(Number),
        });
    });

    test('should handle multiple service initializations', () => {
        // First initialization
        initService({ serviceName: 'Service 1' });
        expect(mockInitBatchInsertQueue).toHaveBeenCalledTimes(1);

        // Second initialization
        initService({ serviceName: 'Service 2' });
        expect(mockInitBatchInsertQueue).toHaveBeenCalledTimes(2);
    });
});
