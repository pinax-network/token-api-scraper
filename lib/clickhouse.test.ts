import { beforeEach, describe, expect, mock, test } from 'bun:test';

const mockJson = mock(() => Promise.resolve([]));
const mockQuery = mock(() =>
    Promise.resolve({
        json: mockJson,
    }),
);
const mockCommand = mock(() => Promise.resolve());
const mockInsert = mock(() => Promise.resolve());
const mockClose = mock(() => Promise.resolve());
const mockCreateClient = mock(() => ({
    query: mockQuery,
    command: mockCommand,
    insert: mockInsert,
    close: mockClose,
}));

mock.module('@clickhouse/client', () => ({
    createClient: mockCreateClient,
}));

const {
    client,
    getClickHouseRequestTimeoutMs,
    insertClient,
    parseClickHouseRequestTimeoutMs,
    query,
    setupClient,
} = await import('./clickhouse');

describe('ClickHouse client exports', () => {
    beforeEach(() => {
        delete process.env.CLICKHOUSE_REQUEST_TIMEOUT_MS;
        mockJson.mockClear();
        mockQuery.mockClear();
        mockCommand.mockClear();
        mockInsert.mockClear();
        mockClose.mockClear();
        mockCreateClient.mockClear();
    });

    test('should configure the ClickHouse clients with the default request timeout', () => {
        expect(mockCreateClient).toHaveBeenCalledTimes(0);

        expect(typeof client.query).toBe('function');
        expect(mockCreateClient).toHaveBeenCalledTimes(1);
        expect(mockCreateClient).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                request_timeout: 300000,
            }),
        );

        expect(typeof insertClient.insert).toBe('function');
        expect(mockCreateClient).toHaveBeenCalledTimes(2);
        expect(mockCreateClient).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                request_timeout: 300000,
            }),
        );

        expect(typeof setupClient.query).toBe('function');
        expect(mockCreateClient).toHaveBeenCalledTimes(3);
        expect(mockCreateClient).toHaveBeenNthCalledWith(
            3,
            expect.objectContaining({
                request_timeout: 300000,
            }),
        );
    });

    test('insertClient should export insert and close methods', () => {
        expect(typeof insertClient.insert).toBe('function');
        expect(typeof insertClient.close).toBe('function');
    });

    test('client should export all methods', () => {
        expect(typeof client.query).toBe('function');
        expect(typeof client.command).toBe('function');
        expect(typeof client.insert).toBe('function');
        expect(typeof client.close).toBe('function');
    });

    test('setupClient should export query, command, and close methods', () => {
        expect(typeof setupClient.query).toBe('function');
        expect(typeof setupClient.command).toBe('function');
        expect(typeof setupClient.close).toBe('function');
    });

    test('should use a 5 minute ClickHouse request timeout by default', () => {
        expect(getClickHouseRequestTimeoutMs()).toBe(300000);
    });

    test('should parse an explicit ClickHouse request timeout', () => {
        expect(parseClickHouseRequestTimeoutMs('45000')).toBe(45000);
    });

    test('should fall back to the default timeout when an explicit timeout is invalid', () => {
        expect(parseClickHouseRequestTimeoutMs('invalid')).toBe(300000);
    });

    test('query should pass the SQL and query params through to ClickHouse', async () => {
        await query('SELECT 1');

        expect(mockQuery).toHaveBeenCalledWith({
            query: 'SELECT 1',
            query_params: {},
            format: 'JSONEachRow',
        });
    });

    test('query should wrap timeout failures with the ClickHouse URL context', async () => {
        mockQuery.mockRejectedValueOnce(new Error('timeout exceeded'));

        await expect(query('SELECT 1')).rejects.toThrow(
            'Failed to connect to ClickHouse at http://localhost:8123: timeout exceeded',
        );
    });
});
