import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { TronWeb } from 'tronweb';
import {
    abi,
    callContract,
    decodeUint256,
    getContractCode,
    getNativeBalance,
} from './rpc';

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
    // eth_getCode -> contract bytecode (example)
    code: '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe',
    // eth_getCode -> empty (self-destructed or EOA)
    emptyCode: '0x',
};

/**
 * Mock fetch implementation that returns predefined responses
 */
const mockFetch = async (
    _url: string,
    options?: RequestInit,
): Promise<Response> => {
    if (!options?.body) {
        throw new Error('Request body is required');
    }

    const body = JSON.parse(options.body as string);

    // Determine which mock response to return based on the method and data
    let result = '0x';
    const method = body.method;

    if (method === 'eth_call') {
        const params = body.params;
        if (!params || !Array.isArray(params) || params.length === 0) {
            throw new Error('Invalid params for eth_call');
        }

        const data = params[0]?.data;
        if (typeof data !== 'string') {
            throw new Error('Invalid data parameter for eth_call');
        }

        // Match function selector (first 10 chars: 0x + 8 hex chars)
        const selector = data.slice(0, 10);

        // Function selectors (keccak256 of signature, first 4 bytes)
        const DECIMALS_SELECTOR = '0x313ce567'; // decimals()
        const NAME_SELECTOR = '0x06fdde03'; // name()
        const SYMBOL_SELECTOR = '0x95d89b41'; // symbol()
        const BALANCE_OF_SELECTOR = '0x70a08231'; // balanceOf(address)

        if (selector === DECIMALS_SELECTOR) {
            result = MOCK_RESPONSES.decimals;
        } else if (selector === NAME_SELECTOR) {
            result = MOCK_RESPONSES.name;
        } else if (selector === SYMBOL_SELECTOR) {
            result = MOCK_RESPONSES.symbol;
        } else if (selector === BALANCE_OF_SELECTOR) {
            result = MOCK_RESPONSES.balanceOf;
        }
    } else if (method === 'eth_getBalance') {
        result = MOCK_RESPONSES.balance;
    } else if (method === 'eth_getCode') {
        result = MOCK_RESPONSES.code; // Default to returning contract code
    }

    const response = {
        jsonrpc: '2.0',
        id: body.id,
        result: result,
    };

    return {
        ok: true,
        status: 200,
        json: async () => response,
    } as Response;
};

describe('RPC decoders', () => {
    let originalFetch: typeof fetch;
    let originalNodeUrl: string | undefined;

    beforeAll(() => {
        // Store original fetch and NODE_URL, then replace with mocks
        originalFetch = globalThis.fetch;
        originalNodeUrl = process.env.NODE_URL;
        globalThis.fetch = mockFetch as any;
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

    test('should decode contract data', async () => {
        const log_address = 'TCCA2WH8e1EJEUNkt1FNwmEjWWbgZm28vb'; // ERC-20 contract address
        const account = 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ'; // EVM address

        // decimals()
        const decHex = await callContract(log_address, 'decimals()');
        const decimals = Number(decodeUint256(decHex));

        // name()
        const nameHex = await callContract(log_address, 'name()');
        const [name] = abi.decode(
            ['string'],
            '0x' + nameHex.replace(/^0x/, ''),
        );

        // symbol()
        const symbolHex = await callContract(log_address, 'symbol()');
        const [symbol] = abi.decode(
            ['string'],
            '0x' + symbolHex.replace(/^0x/, ''),
        );

        // balanceOf(address) - with args (new 4-arg style)
        const balHex = await callContract(
            log_address,
            'balanceOf(address)',
            [account],
            { retries: 1, timeoutMs: 2000 },
        );
        const bal = decodeUint256(balHex);

        // Verify we got the expected mocked data back
        expect(decimals).toBe(6);
        expect(name).toBe('Test Token');
        expect(symbol).toBe('TST');
        expect(bal).toBe(1000000000n);
    });

    test('should handle both Tron base58 and EVM hex addresses', async () => {
        const base58_address = 'TCCA2WH8e1EJEUNkt1FNwmEjWWbgZm28vb'; // ERC-20 contract address in base58

        // Convert base58 to hex format (41 prefix + 20 bytes)
        const tronHex = TronWeb.address.toHex(base58_address);
        // Remove 41 prefix to get EVM hex format
        const evmHex = '0x' + tronHex.replace(/^41/i, '');

        // Call with base58 address
        const decimalsFromBase58 = await callContract(
            base58_address,
            'decimals()',
        );
        const decimals1 = Number(decodeUint256(decimalsFromBase58));

        // Call with EVM hex address - should produce same result
        const decimalsFromHex = await callContract(evmHex, 'decimals()');
        const decimals2 = Number(decodeUint256(decimalsFromHex));

        // Both should return the same value
        expect(decimals1).toBe(decimals2);
        expect(decimals1).toBe(6);
    });

    test('should decode uint256 values correctly', () => {
        // Test decoding of different uint256 values
        const testCases = [
            {
                hex: '0x0000000000000000000000000000000000000000000000000000000000000006',
                expected: 6n,
            },
            {
                hex: '0x000000000000000000000000000000000000000000000000000000003b9aca00',
                expected: 1000000000n,
            },
            {
                hex: '0x0000000000000000000000000000000000000000000000000000000000000000',
                expected: 0n,
            },
        ];

        for (const { hex, expected } of testCases) {
            const result = decodeUint256(hex);
            expect(result).toBe(expected);
        }
    });

    test('should get native balance', async () => {
        const account = 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ';

        const balanceHex = await getNativeBalance(account);

        // Verify we got a hex string back
        expect(balanceHex).toBe('0x1bc16d674ec80000');
        expect(balanceHex.startsWith('0x')).toBe(true);

        // Should be able to decode as bigint
        const balanceWei = BigInt(balanceHex);
        expect(balanceWei).toBeGreaterThan(0n);
    });

    test('should handle empty responses', async () => {
        // Temporarily replace with empty response mock
        const emptyMockFetch = async (
            _url: string,
            options?: RequestInit,
        ): Promise<Response> => {
            if (!options?.body) {
                throw new Error('Request body is required');
            }

            const body = JSON.parse(options.body as string);
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

        const savedFetch = globalThis.fetch;
        try {
            globalThis.fetch = emptyMockFetch as any;

            const result = await callContract(
                'TCCA2WH8e1EJEUNkt1FNwmEjWWbgZm28vb',
                'decimals()',
            );

            // Empty response should return empty string
            expect(result).toBe('');
        } finally {
            // Always restore the regular mock even if test fails
            globalThis.fetch = savedFetch;
        }
    });

    test('should get contract code', async () => {
        const contract = 'TCCA2WH8e1EJEUNkt1FNwmEjWWbgZm28vb';

        const code = await getContractCode(contract);

        // Verify we got a hex string back with code
        expect(code).toBe(MOCK_RESPONSES.code);
        expect(code.startsWith('0x')).toBe(true);
        expect(code.length).toBeGreaterThan(2); // More than just "0x"
    });

    test('should detect self-destructed contract with no code', async () => {
        // Temporarily replace with empty code response mock
        const emptyCodeMockFetch = async (
            _url: string,
            options?: RequestInit,
        ): Promise<Response> => {
            if (!options?.body) {
                throw new Error('Request body is required');
            }

            const body = JSON.parse(options.body as string);
            const response = {
                jsonrpc: '2.0',
                id: body.id,
                result: '0x', // No code
            };

            return {
                ok: true,
                status: 200,
                json: async () => response,
            } as Response;
        };

        const savedFetch = globalThis.fetch;
        try {
            globalThis.fetch = emptyCodeMockFetch as any;

            const code = await getContractCode(
                'TCCA2WH8e1EJEUNkt1FNwmEjWWbgZm28vb',
            );

            // Empty code indicates self-destructed or EOA
            expect(code).toBe('0x');
        } finally {
            // Always restore the regular mock even if test fails
            globalThis.fetch = savedFetch;
        }
    });
});
