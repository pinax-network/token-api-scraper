import { describe, expect, test } from 'bun:test';
import { client, readClient, writeClient } from './clickhouse';

describe('ClickHouse client exports', () => {
    test('readClient should export query and close methods', () => {
        expect(typeof readClient.query).toBe('function');
        expect(typeof readClient.close).toBe('function');
    });

    test('writeClient should export command, insert, and close methods', () => {
        expect(typeof writeClient.command).toBe('function');
        expect(typeof writeClient.insert).toBe('function');
        expect(typeof writeClient.close).toBe('function');
    });

    test('deprecated client should export all methods for backward compatibility', () => {
        expect(typeof client.query).toBe('function');
        expect(typeof client.command).toBe('function');
        expect(typeof client.insert).toBe('function');
        expect(typeof client.close).toBe('function');
    });
});
