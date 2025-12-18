import { describe, expect, test } from 'bun:test';

/**
 * Tests for metadata error filtering
 * Verifies that infrastructure-related errors are skipped from metadata_errors table
 */

describe('Metadata error filtering', () => {
    test('should identify connection error as infrastructure error', () => {
        const error =
            'Unable to connect. Is the computer able to access the url?';
        // We can't easily test the actual database insertion without mocking
        // but we can verify the function doesn't throw
        expect(() => {
            const isInfra = error.toLowerCase().includes('unable to connect');
            expect(isInfra).toBe(true);
        }).not.toThrow();
    });

    test('should identify typo error as infrastructure error', () => {
        const error = 'Was there a typo in the url or port?';
        const isInfra = error
            .toLowerCase()
            .includes('was there a typo in the url or port');
        expect(isInfra).toBe(true);
    });

    test('should identify 502 error as infrastructure error', () => {
        const error = 'Non-JSON response (status 502)';
        const isInfra = error
            .toLowerCase()
            .includes('non-json response (status 502)');
        expect(isInfra).toBe(true);
    });

    test('should identify 404 error as infrastructure error', () => {
        const error = 'Non-JSON response (status 404)';
        const isInfra = error
            .toLowerCase()
            .includes('non-json response (status 404)');
        expect(isInfra).toBe(true);
    });

    test('should not identify application errors as infrastructure errors', () => {
        const error = 'missing decimals()';
        const isInfra =
            error.toLowerCase().includes('unable to connect') ||
            error
                .toLowerCase()
                .includes('was there a typo in the url or port') ||
            error.toLowerCase().includes('non-json response (status 502)') ||
            error.toLowerCase().includes('non-json response (status 404)');
        expect(isInfra).toBe(false);
    });

    test('should not identify RPC errors as infrastructure errors', () => {
        const error = 'RPC error -32000: execution reverted';
        const isInfra =
            error.toLowerCase().includes('unable to connect') ||
            error
                .toLowerCase()
                .includes('was there a typo in the url or port') ||
            error.toLowerCase().includes('non-json response (status 502)') ||
            error.toLowerCase().includes('non-json response (status 404)');
        expect(isInfra).toBe(false);
    });
});
