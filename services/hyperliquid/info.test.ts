import { afterEach, describe, expect, mock, test } from 'bun:test';
import { TransientUpstreamError } from '../../lib/errors';
import { type InfoRetryOptions, postInfo } from './info';

const noDelay: InfoRetryOptions = { retries: 3, baseDelayMs: 0, maxDelayMs: 0 };
const url = 'http://example/info';

function dnsError(code: string): Error {
    return Object.assign(
        new TypeError(`getaddrinfo ${code} hyperliquid.rpc.pinax.network`),
        { code },
    );
}

/** Each call to fetch returns (or throws) the next item in `outcomes`. */
function mockFetch(outcomes: Array<Response | Error>) {
    let call = 0;
    const fn = mock(() => {
        const next = outcomes[Math.min(call++, outcomes.length - 1)];
        return next instanceof Error
            ? Promise.reject(next)
            : Promise.resolve(next);
    });
    globalThis.fetch = fn as unknown as typeof fetch;
    return fn;
}

const ok = () => new Response(JSON.stringify({ tokens: [] }), { status: 200 });

describe('postInfo', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test('POSTs the request type as JSON', async () => {
        const fetchMock = mockFetch([ok()]);
        await postInfo(url, { type: 'spotMeta' }, noDelay);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            url,
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ type: 'spotMeta' }),
            }),
        );
    });

    test('retries a 502 and returns the body once the upstream recovers', async () => {
        const fetchMock = mockFetch([
            new Response('bad gateway', { status: 502 }),
            ok(),
        ]);
        expect(await postInfo(url, { type: 'spotMeta' }, noDelay)).toEqual({
            tokens: [],
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('retries a temporary DNS failure (EAI_AGAIN)', async () => {
        const fetchMock = mockFetch([dnsError('EAI_AGAIN'), ok()]);
        expect(await postInfo(url, { type: 'spotMeta' }, noDelay)).toEqual({
            tokens: [],
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('throws TransientUpstreamError once retries run out on a 503', async () => {
        const fetchMock = mockFetch([
            new Response('unavailable', { status: 503 }),
        ]);
        const error = await postInfo(url, { type: 'spotMeta' }, noDelay).catch(
            (e) => e,
        );
        expect(error).toBeInstanceOf(TransientUpstreamError);
        expect(error.message).toBe('Hyperliquid /info returned HTTP 503');
        expect(fetchMock).toHaveBeenCalledTimes(noDelay.retries + 1);
    });

    test('throws TransientUpstreamError once retries run out on a refused connection', async () => {
        const refused = Object.assign(
            new TypeError('ECONNREFUSED: Unable to connect.'),
            { code: 'ECONNREFUSED' },
        );
        const fetchMock = mockFetch([refused]);
        const error = await postInfo(url, { type: 'spotMeta' }, noDelay).catch(
            (e) => e,
        );
        expect(error).toBeInstanceOf(TransientUpstreamError);
        expect(error.cause).toBe(refused);
        expect(fetchMock).toHaveBeenCalledTimes(noDelay.retries + 1);
    });

    test('does not retry a non-retryable status', async () => {
        const fetchMock = mockFetch([new Response('bad', { status: 400 })]);
        const error = await postInfo(url, { type: 'spotMeta' }, noDelay).catch(
            (e) => e,
        );
        expect(error).not.toBeInstanceOf(TransientUpstreamError);
        expect(error.message).toBe('Hyperliquid /info returned HTTP 400');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('does not retry a host that does not resolve (ENOTFOUND)', async () => {
        const notFound = dnsError('ENOTFOUND');
        const fetchMock = mockFetch([notFound]);
        const error = await postInfo(url, { type: 'spotMeta' }, noDelay).catch(
            (e) => e,
        );
        expect(error).toBe(notFound);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
