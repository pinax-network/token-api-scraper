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

    test('query should pass the configured request timeout to ClickHouse query calls', async () => {
        await query('SELECT 1');

        expect(mockQuery).toHaveBeenCalledWith({
            query: 'SELECT 1',
            query_params: {},
            format: 'JSONEachRow',
            request_timeout: 300000,
        });
    });
});
