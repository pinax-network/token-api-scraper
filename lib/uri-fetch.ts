/**
 * URI Fetcher module for fetching token metadata from external URIs
 * Supports retries and configurable timeouts
 */

import { sleep } from 'bun';
import { DEFAULT_CONFIG } from './config';
import { sanitizeString } from './hex-decode';
import { createLogger } from './logger';

const log = createLogger('uri-fetch');

/** Maximum number of retry attempts for URI fetching (fixed at 3 as per requirement) */
const URI_MAX_RETRIES = 3;

/** Read timeout from environment variables (same as RPC timeout) */
function getTimeoutMs(): number {
    return parseInt(
        process.env.TIMEOUT_MS || String(DEFAULT_CONFIG.TIMEOUT_MS),
        10,
    );
}

/** Read max delay from environment variables (same as RPC retry config) */
function getMaxDelayMs(): number {
    return parseInt(
        process.env.MAX_DELAY_MS || String(DEFAULT_CONFIG.MAX_DELAY_MS),
        10,
    );
}

/**
 * Metadata fetched from a token's URI
 */
export interface UriMetadata {
    name?: string;
    symbol?: string;
    description?: string;
    image?: string;
}

/**
 * Result of fetching metadata from a URI
 */
export interface UriMetadataResult {
    success: boolean;
    metadata?: UriMetadata;
    /** Raw response string from the URI */
    raw?: string;
    error?: string;
}

/**
 * Check if an error is retryable
 */
function isRetryable(error: any, status?: number): boolean {
    const msg = String(error?.message || error || '').toLowerCase();

    // Transport / fetch layer errors
    if (
        msg.includes('network') ||
        msg.includes('econnreset') ||
        msg.includes('etimedout') ||
        msg.includes('enotfound') ||
        msg.includes('socket hang up') ||
        msg.includes('operation was aborted') ||
        msg.includes('fetch failed') ||
        msg.includes('aborterror')
    ) {
        return true;
    }

    // HTTP: transient statuses
    if (status) {
        if (
            [408, 425, 429, 499, 502, 503, 504, 522, 523, 524].includes(status)
        ) {
            return true;
        }
        if (status >= 500) {
            return true;
        }
    }

    return false;
}

/**
 * Validate and normalize a URI
 * Returns null if the URI is invalid or cannot be fetched
 */
function normalizeUri(uri: string): string | null {
    if (!uri || typeof uri !== 'string') {
        return null;
    }

    const trimmedUri = uri.trim();
    if (!trimmedUri) {
        return null;
    }

    // Handle IPFS URIs by converting to gateway URL
    if (trimmedUri.startsWith('ipfs://')) {
        return trimmedUri.replace('ipfs://', 'https://ipfs.io/ipfs/');
    }

    // Handle Arweave URIs
    if (trimmedUri.startsWith('ar://')) {
        return trimmedUri.replace('ar://', 'https://arweave.net/');
    }

    // Validate HTTP(S) URLs
    if (trimmedUri.startsWith('http://') || trimmedUri.startsWith('https://')) {
        try {
            new URL(trimmedUri);
            return trimmedUri;
        } catch {
            return null;
        }
    }

    // Unknown protocol
    return null;
}

/**
 * Fetch metadata from a URI with retry logic
 *
 * @param uri - The URI to fetch metadata from
 * @returns Result containing metadata or error
 */
export async function fetchUriMetadata(
    uri: string,
): Promise<UriMetadataResult> {
    const normalizedUri = normalizeUri(uri);

    if (!normalizedUri) {
        return {
            success: false,
            error: `Invalid URI: ${uri}`,
        };
    }

    const timeoutMs = getTimeoutMs();
    const baseDelayMs = parseInt(
        process.env.BASE_DELAY_MS || String(DEFAULT_CONFIG.BASE_DELAY_MS),
        10,
    );
    const maxDelayMs = getMaxDelayMs();

    let lastError: string | undefined;

    for (let attempt = 1; attempt <= URI_MAX_RETRIES; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);

        try {
            const response = await fetch(normalizedUri, {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'token-api-scraper',
                },
                signal: ctrl.signal,
            });

            clearTimeout(timer);

            if (!response.ok) {
                const retryable = isRetryable(null, response.status);
                lastError = `HTTP ${response.status}`;

                if (!retryable || attempt === URI_MAX_RETRIES) {
                    log.debug(
                        'URI fetch failed (non-retryable or max retries)',
                        {
                            uri: normalizedUri,
                            status: response.status,
                            attempt,
                        },
                    );
                    return {
                        success: false,
                        error: lastError,
                    };
                }

                log.debug('URI fetch failed, retrying', {
                    uri: normalizedUri,
                    status: response.status,
                    attempt,
                    maxAttempts: URI_MAX_RETRIES,
                });

                // Exponential backoff
                const delay = Math.min(
                    baseDelayMs * 2 ** (attempt - 1),
                    maxDelayMs,
                );
                await sleep(delay);
                continue;
            }

            // Get raw response text first
            const rawText = await response.text();

            // Try to parse as JSON
            let json: any;
            try {
                json = JSON.parse(rawText);
            } catch (parseError) {
                lastError = 'Failed to parse JSON response';
                log.debug('Failed to parse URI response as JSON', {
                    uri: normalizedUri,
                    error: (parseError as Error).message,
                });
                return {
                    success: false,
                    raw: rawText,
                    error: lastError,
                };
            }

            // Extract and sanitize metadata fields (remove NULL bytes and trim)
            const metadata: UriMetadata = {
                name:
                    typeof json.name === 'string'
                        ? sanitizeString(json.name)
                        : undefined,
                symbol:
                    typeof json.symbol === 'string'
                        ? sanitizeString(json.symbol)
                        : undefined,
                description:
                    typeof json.description === 'string'
                        ? sanitizeString(json.description)
                        : undefined,
                image: typeof json.image === 'string' ? json.image : undefined,
            };

            log.debug('URI metadata fetched successfully', {
                uri: normalizedUri,
                hasName: !!metadata.name,
                hasSymbol: !!metadata.symbol,
                hasDescription: !!metadata.description,
                hasImage: !!metadata.image,
            });

            return {
                success: true,
                metadata,
                raw: rawText,
            };
        } catch (error) {
            clearTimeout(timer);
            const errorMessage = (error as Error).message || String(error);
            lastError = errorMessage;

            const retryable = isRetryable(error);

            if (!retryable || attempt === URI_MAX_RETRIES) {
                log.debug('URI fetch failed (non-retryable or max retries)', {
                    uri: normalizedUri,
                    error: errorMessage,
                    attempt,
                });
                return {
                    success: false,
                    error: lastError,
                };
            }

            log.debug('URI fetch failed, retrying', {
                uri: normalizedUri,
                error: errorMessage,
                attempt,
                maxAttempts: URI_MAX_RETRIES,
            });

            // Exponential backoff
            const delay = Math.min(
                baseDelayMs * 2 ** (attempt - 1),
                maxDelayMs,
            );
            await sleep(delay);
        }
    }

    // Shouldn't reach here, but return error just in case
    return {
        success: false,
        error: lastError || 'Unknown error',
    };
}
