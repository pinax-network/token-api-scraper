import { describe, expect, test } from 'bun:test';
import { client, insertClient } from './clickhouse';

describe('ClickHouse client exports', () => {
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
});
