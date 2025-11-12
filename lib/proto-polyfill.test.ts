import { describe, test, expect } from 'bun:test';

/**
 * Test to verify the proto polyfill is working correctly
 * This ensures that the global proto object exists and can be extended
 */
describe('Proto Polyfill', () => {
    test('proto global should exist', () => {
        // The polyfill should have created a global proto object
        expect((globalThis as any).proto).toBeDefined();
        expect(typeof (globalThis as any).proto).toBe('object');
    });

    test('proto can be extended without errors', () => {
        // This simulates what tronweb's generated code does
        const testData = { test: 'value' };
        Object.assign((globalThis as any).proto, testData);
        
        expect((globalThis as any).proto.test).toBe('value');
    });
});
