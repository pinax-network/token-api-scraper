import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createClient } from '@clickhouse/client';
import { withDeadline } from './clickhouse';

// A ClickHouse stand-in that can stall before the headers or after them.
const headers = {
    'Content-Type': 'application/json',
    'X-ClickHouse-Query-Id': 'test',
    'X-ClickHouse-Format': 'JSONEachRow',
};
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
    server = Bun.serve({
        port: 0,
        async fetch(req) {
            const body = `${req.url} ${await req.text()}`;
            if (body.includes('STALL_HEADERS')) {
                return new Promise<Response>(() => {});
            }
            if (body.includes('STALL_BODY')) {
                // One row, then the chunked body never ends.
                const stream = new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(
                            new TextEncoder().encode('{"n":1}\n'),
                        );
                    },
                });
                return new Response(stream, { headers });
            }
            return new Response('{"n":1}\n', { headers });
        },
    });
});

afterAll(() => {
    server.stop(true);
});

function stub() {
    return createClient({
        url: `http://127.0.0.1:${server.port}`,
        request_timeout: 60_000,
    });
}

describe('withDeadline', () => {
    test('passes the rows through when the server answers', async () => {
        const ch = stub();
        const rows = await withDeadline(
            'read',
            async (signal) => {
                const rs = await ch.query({
                    query: 'SELECT 1',
                    format: 'JSONEachRow',
                    abort_signal: signal,
                });
                return rs.json<{ n: number }>();
            },
            1000,
            'query',
        );
        expect(rows).toEqual([{ n: 1 }]);
        await ch.close();
    });

    test('rejects when the body stalls after the headers arrived', async () => {
        const ch = stub();
        const started = performance.now();
        await expect(
            withDeadline(
                'read',
                async (signal) => {
                    const rs = await ch.query({
                        query: 'SELECT STALL_BODY',
                        format: 'JSONEachRow',
                        abort_signal: signal,
                    });
                    return rs.json();
                },
                300,
                'query',
            ),
        ).rejects.toThrow('ClickHouse query timed out after 300ms');
        expect(performance.now() - started).toBeLessThan(3000);
    });

    test('rejects when no headers arrive', async () => {
        const ch = stub();
        await expect(
            withDeadline(
                'insert',
                (signal) =>
                    ch.insert({
                        table: 'STALL_HEADERS',
                        format: 'JSONEachRow',
                        values: [{ n: 1 }],
                        abort_signal: signal,
                    }),
                300,
                'insert into STALL_HEADERS',
            ),
        ).rejects.toThrow('insert into STALL_HEADERS timed out after 300ms');
    });
});
