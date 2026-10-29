import { describe, expect, test } from 'bun:test';
import { isTransientUpstreamError, TransientUpstreamError } from './errors';

describe('isTransientUpstreamError', () => {
    test('accepts a TransientUpstreamError', () => {
        expect(
            isTransientUpstreamError(new TransientUpstreamError('HTTP 502')),
        ).toBe(true);
    });

    test('rejects a plain Error and non-errors', () => {
        expect(isTransientUpstreamError(new Error('HTTP 400'))).toBe(false);
        expect(isTransientUpstreamError('HTTP 502')).toBe(false);
        expect(isTransientUpstreamError(undefined)).toBe(false);
    });

    test('accepts an AggregateError when every member is transient', () => {
        const error = new AggregateError([
            new TransientUpstreamError('HTTP 502'),
            new TransientUpstreamError('getaddrinfo EAI_AGAIN'),
        ]);
        expect(isTransientUpstreamError(error)).toBe(true);
    });

    test('rejects an AggregateError that mixes in another failure', () => {
        const error = new AggregateError([
            new TransientUpstreamError('HTTP 502'),
            new Error('ClickHouse insert failed'),
        ]);
        expect(isTransientUpstreamError(error)).toBe(false);
    });

    test('rejects an empty AggregateError', () => {
        expect(isTransientUpstreamError(new AggregateError([]))).toBe(false);
    });
});
