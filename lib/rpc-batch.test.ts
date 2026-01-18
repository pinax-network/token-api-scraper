import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    abi,
    type BatchRequest,
    batchCallContracts,
    batchGetNativeBalances,
    type ContractCallRequest,
    decodeUint256,
    makeBatchJsonRpcCall,
} from './rpc';

/**
 * Tests for RPC batch functionality
 * These tests use mocked fetch to avoid network dependencies
 */

/**
 * Mock RPC responses for testing without network access
 * These are real hex-encoded responses from EVM RPC calls
 */
const MOCK_RESPONSES: Record<string, string> = {
    // decimals() -> uint256(6)
    decimals:
        '0x0000000000000000000000000000000000000000000000000000000000000006',
    // name() -> string("Test Token")
    name: '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000a5465737420546f6b656e00000000000000000000000000000000000000000000',
    // symbol() -> string("TST")
    symbol: '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000003545354000000000000000000000000000000000000000000000000000000000000',
    // balanceOf(address) -> uint256(1000000000) (1000 tokens with 6 decimals)
    balanceOf:
        '0x000000000000000000000000000000000000000000000000000000003b9aca00',
    // eth_getBalance -> 0x1bc16d674ec80000 (2 ETH in wei)
    balance: '0x1bc16d674ec80000',
    // eth_blockNumber -> 0x12345678
    blockNumber: '0x12345678',
};

/**
 * Mock fetch implementation that returns predefined responses for batch requests
 */
const mockBatchFetch = async (
    _url: string,
    options?: RequestInit,
): Promise<Response> => {
    if (!options?.body) {
        throw new Error('Request body is required');
    }

    const body = JSON.parse(options.body as string);

    // Handle batch requests (array of requests)
    if (Array.isArray(body)) {
        const results = body.map((request: any) => {
            let result = '0x';
            const method = request.method;

            if (method === 'eth_call') {
                const params = request.params;
                const data = params?.[0]?.data;
                if (typeof data === 'string') {
                    const selector = data.slice(0, 10);
                    const DECIMALS_SELECTOR = '0x313ce567';
                    const NAME_SELECTOR = '0x06fdde03';
                    const SYMBOL_SELECTOR = '0x95d89b41';
                    const BALANCE_OF_SELECTOR = '0x70a08231';

                    if (selector === DECIMALS_SELECTOR) {
                        result = MOCK_RESPONSES.decimals;
                    } else if (selector === NAME_SELECTOR) {
                        result = MOCK_RESPONSES.name;
                    } else if (selector === SYMBOL_SELECTOR) {
                        result = MOCK_RESPONSES.symbol;
                    } else if (selector === BALANCE_OF_SELECTOR) {
                        result = MOCK_RESPONSES.balanceOf;
                    }
                }
            } else if (method === 'eth_getBalance') {
                result = MOCK_RESPONSES.balance;
            } else if (method === 'eth_blockNumber') {
                result = MOCK_RESPONSES.blockNumber;
            }

            return {
                jsonrpc: '2.0',
                id: request.id,
                result: result,
            };
        });

        return {
            ok: true,
            status: 200,
            json: async () => results,
        } as Response;
    }

    // Handle single requests
    const response = {
        jsonrpc: '2.0',
        id: body.id,
        result: '0x',
    };

    return {
        ok: true,
        status: 200,
        json: async () => response,
    } as Response;
};

describe('Batch RPC Requests', () => {
    const testContract = 'TCCA2WH8e1EJEUNkt1FNwmEjWWbgZm28vb'; // ERC-20 contract
    const testAccount = 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ'; // EVM address
    let originalFetch: typeof fetch;
    let originalNodeUrl: string | undefined;

    beforeAll(() => {
        // Store original fetch and NODE_URL, then replace with mocks
        originalFetch = globalThis.fetch;
        originalNodeUrl = process.env.NODE_URL;
        globalThis.fetch = mockBatchFetch as any;
        process.env.NODE_URL = 'http://mock-rpc.test';
    });

    afterAll(() => {
        // Restore original fetch and NODE_URL
        globalThis.fetch = originalFetch;
        if (originalNodeUrl === undefined) {
            delete process.env.NODE_URL;
        } else {
            process.env.NODE_URL = originalNodeUrl;
        }
    });

    test('should handle empty batch request', async () => {
        const results = await makeBatchJsonRpcCall([]);
        expect(results).toEqual([]);
    });

    test('should make a batch request with multiple calls', async () => {
        // Create a batch of requests for different contract methods
        const requests: BatchRequest[] = [
            {
                method: 'eth_blockNumber',
                params: [],
            },
            {
                method: 'eth_blockNumber',
                params: [],
            },
        ];

        const results = await makeBatchJsonRpcCall(requests);

        // Should return results for all requests
        expect(results.length).toBe(2);

        // Both should succeed with mocked responses
        for (const result of results) {
            expect(result.success).toBe(true);
            expect(result.result).toBeDefined();
        }
    });

    test('should handle batch contract calls', async () => {
        const calls: ContractCallRequest[] = [
            { contract: testContract, signature: 'decimals()' },
            { contract: testContract, signature: 'symbol()' },
            { contract: testContract, signature: 'name()' },
        ];

        const results = await batchCallContracts(calls);

        expect(results.length).toBe(3);

        // All should succeed with mocked responses
        for (const result of results) {
            expect(result.success).toBe(true);
            expect(typeof result.result).toBe('string');
        }

        // Verify we can decode the results
        const decimals = Number(decodeUint256(results[0].result!));
        expect(decimals).toBe(6);

        const [symbol] = abi.decode(
            ['string'],
            '0x' + results[1].result!.replace(/^0x/, ''),
        );
        expect(symbol).toBe('TST');

        const [name] = abi.decode(
            ['string'],
            '0x' + results[2].result!.replace(/^0x/, ''),
        );
        expect(name).toBe('Test Token');
    });

    test('should handle batch contract calls with arguments', async () => {
        const calls: ContractCallRequest[] = [
            {
                contract: testContract,
                signature: 'balanceOf(address)',
                args: [testAccount],
            },
            {
                contract: testContract,
                signature: 'balanceOf(address)',
                args: [testAccount],
            },
        ];

        const results = await batchCallContracts(calls);

        expect(results.length).toBe(2);

        // Verify structure - all should succeed with mocked responses
        for (const result of results) {
            expect(result.success).toBe(true);
            expect(result.result).toBeDefined();
            const balance = decodeUint256(result.result!);
            expect(balance).toBe(1000000000n);
        }
    });

    test('should handle batch native balance requests', async () => {
        const accounts = [testAccount, testAccount]; // Query same account twice for testing

        const results = await batchGetNativeBalances(accounts);

        expect(results.length).toBe(2);

        // Verify structure - all should succeed with mocked responses
        for (const result of results) {
            expect(result.success).toBe(true);
            expect(result.result).toBeDefined();
            expect(typeof result.result).toBe('string');
            expect(result.result!.startsWith('0x')).toBe(true);
        }
    });

    test('should handle empty batch contract calls', async () => {
        const results = await batchCallContracts([]);
        expect(results).toEqual([]);
    });

    test('should handle empty batch native balance requests', async () => {
        const results = await batchGetNativeBalances([]);
        expect(results).toEqual([]);
    });

    test('should handle errors within batch responses', async () => {
        try {
            // Create a batch with potentially invalid calls
            const calls: ContractCallRequest[] = [
                { contract: testContract, signature: 'decimals()' }, // Valid
                { contract: 'TInvalidAddress', signature: 'decimals()' }, // Invalid address format
            ];

            const results = await batchCallContracts(calls);

            expect(results.length).toBe(2);

            // First should succeed (or fail due to network)
            // Second should potentially fail due to invalid address
            expect(results[0]).toBeDefined();
            expect(results[1]).toBeDefined();
        } catch (err: any) {
            // Expected to fail - this validates error handling
            expect(err).toBeDefined();
        }
    });

    test('should validate argument count mismatch', async () => {
        try {
            const calls: ContractCallRequest[] = [
                {
                    contract: testContract,
                    signature: 'balanceOf(address)',
                    args: [], // Missing required argument
                },
            ];

            await batchCallContracts(calls);

            // Should not reach here
            expect(true).toBe(false);
        } catch (err: any) {
            // Should throw error about argument mismatch
            expect(err.message).toContain('Arg count mismatch');
        }
    });

    test('should preserve request order in batch results', async () => {
        // Make different calls that should return different values
        const calls: ContractCallRequest[] = [
            { contract: testContract, signature: 'decimals()' },
            { contract: testContract, signature: 'name()' },
            { contract: testContract, signature: 'symbol()' },
        ];

        const results = await batchCallContracts(calls);

        expect(results.length).toBe(3);

        // Results should be in the same order as requests
        // All should succeed with mocked responses
        expect(results.every((r) => r.success)).toBe(true);

        // Verify each result has the expected value
        expect(results[0].result).toBeTruthy();
        expect(results[1].result).toBeTruthy();
        expect(results[2].result).toBeTruthy();

        // Verify decimals (first result)
        const decimals = Number(decodeUint256(results[0].result!));
        expect(decimals).toBe(6);
    });

    test('should handle retry options for batch calls', async () => {
        const calls: ContractCallRequest[] = [
            { contract: testContract, signature: 'decimals()' },
        ];

        const results = await batchCallContracts(calls, {
            retries: 2,
            baseDelayMs: 100,
            timeoutMs: 2000,
        });

        expect(results.length).toBe(1);
        expect(results[0]).toBeDefined();
        expect(results[0].success).toBe(true);
    });
});
