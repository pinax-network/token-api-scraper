import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * Tests for URI fetch module
 */

// Mock logger to avoid console output during tests
mock.module('./logger', () => ({
    createLogger: () => ({
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
    }),
}));

// Import after mocking
import { fetchUriMetadata } from './uri-fetch';

describe('URI Fetch Module', () => {
    beforeEach(() => {
        // Reset fetch mock between tests
    });

    describe('URI normalization', () => {
        test('should reject invalid URIs', async () => {
            const result = await fetchUriMetadata('');
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid URI');
        });

        test('should reject null URIs', async () => {
            const result = await fetchUriMetadata(null as unknown as string);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid URI');
        });

        test('should reject undefined URIs', async () => {
            const result = await fetchUriMetadata(
                undefined as unknown as string,
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid URI');
        });

        test('should reject URIs with unknown protocols', async () => {
            const result = await fetchUriMetadata(
                'ftp://example.com/metadata.json',
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid URI');
        });
    });

    describe('IPFS URI handling', () => {
        test('should handle IPFS URIs correctly', async () => {
            // This tests the normalization without actually fetching
            // We can verify the normalization behavior through the error message
            // when the fetch fails (it will show the normalized URL)
            const originalFetch = globalThis.fetch;
            let capturedUrl: string | undefined;
            const testJson = {
                name: 'Test',
                description: 'Test description',
                image: 'https://example.com/image.png',
            };

            globalThis.fetch = mock(async (url: string | URL | Request) => {
                capturedUrl = url.toString();
                return {
                    ok: true,
                    text: async () => JSON.stringify(testJson),
                } as Response;
            }) as unknown as typeof globalThis.fetch;

            try {
                await fetchUriMetadata(
                    'ipfs://bafkreixxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                );
                expect(capturedUrl).toContain('https://ipfs.io/ipfs/');
            } finally {
                globalThis.fetch = originalFetch;
            }
        });
    });

    describe('Arweave URI handling', () => {
        test('should handle Arweave URIs correctly', async () => {
            const originalFetch = globalThis.fetch;
            let capturedUrl: string | undefined;
            const testJson = {
                name: 'Test',
                description: 'Test description',
                image: 'https://example.com/image.png',
            };

            globalThis.fetch = mock(async (url: string | URL | Request) => {
                capturedUrl = url.toString();
                return {
                    ok: true,
                    text: async () => JSON.stringify(testJson),
                } as Response;
            }) as unknown as typeof globalThis.fetch;

            try {
                await fetchUriMetadata('ar://some-arweave-id');
                expect(capturedUrl).toContain('https://arweave.net/');
            } finally {
                globalThis.fetch = originalFetch;
            }
        });
    });

    describe('Successful metadata fetch', () => {
        test('should extract metadata fields from JSON response', async () => {
            const originalFetch = globalThis.fetch;
            const testJson = {
                name: 'Test Token',
                symbol: 'TEST',
                description: 'A test token for testing',
                image: 'https://example.com/image.png',
            };

            globalThis.fetch = mock(async () => {
                return {
                    ok: true,
                    text: async () => JSON.stringify(testJson),
                } as Response;
            }) as unknown as typeof globalThis.fetch;

            try {
                const result = await fetchUriMetadata(
                    'https://example.com/metadata.json',
                );
                expect(result.success).toBe(true);
                expect(result.metadata?.name).toBe('Test Token');
                expect(result.metadata?.symbol).toBe('TEST');
                expect(result.metadata?.description).toBe(
                    'A test token for testing',
                );
                expect(result.metadata?.image).toBe(
                    'https://example.com/image.png',
                );
                expect(result.raw).toBe(JSON.stringify(testJson));
            } finally {
                globalThis.fetch = originalFetch;
            }
        });

        test('should handle partial metadata', async () => {
            const originalFetch = globalThis.fetch;
            const testJson = {
                description: 'Only description',
                image: 'https://example.com/image.png',
            };

            globalThis.fetch = mock(async () => {
                return {
                    ok: true,
                    text: async () => JSON.stringify(testJson),
                } as Response;
            }) as unknown as typeof globalThis.fetch;

            try {
                const result = await fetchUriMetadata(
                    'https://example.com/metadata.json',
                );
                expect(result.success).toBe(true);
                expect(result.metadata?.name).toBeUndefined();
                expect(result.metadata?.symbol).toBeUndefined();
                expect(result.metadata?.description).toBe('Only description');
                expect(result.metadata?.image).toBe(
                    'https://example.com/image.png',
                );
                expect(result.raw).toBe(JSON.stringify(testJson));
            } finally {
                globalThis.fetch = originalFetch;
            }
        });

        test('should return raw response string', async () => {
            const originalFetch = globalThis.fetch;
            const rawResponse = '{"name":"Raw Test","extra_field":"ignored"}';

            globalThis.fetch = mock(async () => {
                return {
                    ok: true,
                    text: async () => rawResponse,
                } as Response;
            }) as unknown as typeof globalThis.fetch;

            try {
                const result = await fetchUriMetadata(
                    'https://example.com/metadata.json',
                );
                expect(result.success).toBe(true);
                expect(result.raw).toBe(rawResponse);
                expect(result.metadata?.name).toBe('Raw Test');
            } finally {
                globalThis.fetch = originalFetch;
            }
        });
    });

    describe('Error handling', () => {
        test('should handle HTTP 404 errors', async () => {
            const originalFetch = globalThis.fetch;

            globalThis.fetch = mock(async () => {
                return {
                    ok: false,
                    status: 404,
                } as Response;
            }) as unknown as typeof globalThis.fetch;

            try {
                const result = await fetchUriMetadata(
                    'https://example.com/metadata.json',
                );
                expect(result.success).toBe(false);
                expect(result.error).toContain('HTTP 404');
            } finally {
                globalThis.fetch = originalFetch;
            }
        });

        test('should handle invalid JSON response and return raw', async () => {
            const originalFetch = globalThis.fetch;
            const invalidJson = 'not valid json {{}';

            globalThis.fetch = mock(async () => {
                return {
                    ok: true,
                    text: async () => invalidJson,
                } as Response;
            }) as unknown as typeof globalThis.fetch;

            try {
                const result = await fetchUriMetadata(
                    'https://example.com/metadata.json',
                );
                expect(result.success).toBe(false);
                expect(result.error).toContain('Failed to parse JSON');
                expect(result.raw).toBe(invalidJson);
            } finally {
                globalThis.fetch = originalFetch;
            }
        });

        test('should handle non-string metadata fields', async () => {
            const originalFetch = globalThis.fetch;
            const testJson = {
                name: 123, // number instead of string
                description: { nested: 'object' },
                image: ['array'],
            };

            globalThis.fetch = mock(async () => {
                return {
                    ok: true,
                    text: async () => JSON.stringify(testJson),
                } as Response;
            }) as unknown as typeof globalThis.fetch;

            try {
                const result = await fetchUriMetadata(
                    'https://example.com/metadata.json',
                );
                expect(result.success).toBe(true);
                // Non-string fields should be undefined
                expect(result.metadata?.name).toBeUndefined();
                expect(result.metadata?.description).toBeUndefined();
                expect(result.metadata?.image).toBeUndefined();
                expect(result.raw).toBe(JSON.stringify(testJson));
            } finally {
                globalThis.fetch = originalFetch;
            }
        });
    });

    describe('Retry behavior', () => {
        test('should retry on 500 errors up to 3 times', async () => {
            const originalFetch = globalThis.fetch;
            let fetchCount = 0;

            globalThis.fetch = mock(async () => {
                fetchCount++;
                return {
                    ok: false,
                    status: 500,
                } as Response;
            }) as unknown as typeof globalThis.fetch;

            try {
                const result = await fetchUriMetadata(
                    'https://example.com/metadata.json',
                );
                expect(result.success).toBe(false);
                expect(fetchCount).toBe(3); // Should have retried 3 times
            } finally {
                globalThis.fetch = originalFetch;
            }
        });

        test('should not retry on 404 errors', async () => {
            const originalFetch = globalThis.fetch;
            let fetchCount = 0;

            globalThis.fetch = mock(async () => {
                fetchCount++;
                return {
                    ok: false,
                    status: 404,
                } as Response;
            }) as unknown as typeof globalThis.fetch;

            try {
                const result = await fetchUriMetadata(
                    'https://example.com/metadata.json',
                );
                expect(result.success).toBe(false);
                expect(fetchCount).toBe(1); // Should not retry 404
            } finally {
                globalThis.fetch = originalFetch;
            }
        });

        test('should succeed on retry after transient failure', async () => {
            const originalFetch = globalThis.fetch;
            let fetchCount = 0;
            const testJson = { description: 'Success after retry' };

            globalThis.fetch = mock(async () => {
                fetchCount++;
                if (fetchCount < 2) {
                    return {
                        ok: false,
                        status: 503,
                    } as Response;
                }
                return {
                    ok: true,
                    text: async () => JSON.stringify(testJson),
                } as Response;
            }) as unknown as typeof globalThis.fetch;

            try {
                const result = await fetchUriMetadata(
                    'https://example.com/metadata.json',
                );
                expect(result.success).toBe(true);
                expect(result.metadata?.description).toBe(
                    'Success after retry',
                );
                expect(result.raw).toBe(JSON.stringify(testJson));
                expect(fetchCount).toBe(2);
            } finally {
                globalThis.fetch = originalFetch;
            }
        });
    });
});
