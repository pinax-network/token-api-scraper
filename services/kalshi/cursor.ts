// Per-scope checkpoint persisted in `cursor_state`. Each row is keyed by an
// opaque `scope` string. For data-walking passes (e.g. `trades_live`)
// `last_processed_ts` is the high-watermark of the last row ingested. For
// refresh passes (markets / events / series / candles) the same column doubles
// as a clock — `last_processed_ts` is the time of the last successful run.

import { insertClient, query } from '../../lib/clickhouse';
import { setScopeHeadTime } from '../../lib/prometheus';

export interface CursorCheckpoint {
    scope: string;
    last_cursor: string;
    /** Unix ms (derived from `last_processed_ts`); precision-lossy for trade compares. */
    last_processed_ts_ms: number;
    /** Full µs-precision ISO 8601 string with trailing Z, e.g. `2026-06-01T17:00:00.123456Z`. */
    last_processed_ts_iso: string;
}

interface CursorRow {
    scope: string;
    last_cursor: string;
    last_processed_ts_ms: string | number;
    /** CH returns `YYYY-MM-DDTHH:MM:SS.uuuuuu` (no Z). */
    last_processed_ts_iso: string;
}

export async function getCursor(
    scope: string,
): Promise<CursorCheckpoint | null> {
    const map = await getCursors([scope]);
    return map.get(scope) ?? null;
}

/** Fetch multiple scopes in one CH round-trip; missing scopes are absent from the map. */
export async function getCursors(
    scopes: string[],
): Promise<Map<string, CursorCheckpoint>> {
    if (scopes.length === 0) return new Map();
    const { data } = await query<CursorRow>(
        `SELECT
            scope,
            last_cursor,
            toUnixTimestamp64Milli(last_processed_ts) AS last_processed_ts_ms,
            formatDateTime(last_processed_ts, '%Y-%m-%dT%H:%i:%S.%f', 'UTC') AS last_processed_ts_iso
         FROM cursor_state
         FINAL
         WHERE scope IN ({scopes:Array(String)})`,
        { scopes },
    );
    const map = new Map<string, CursorCheckpoint>();
    for (const r of data) {
        map.set(r.scope, {
            scope: r.scope,
            last_cursor: r.last_cursor,
            last_processed_ts_ms: Number(r.last_processed_ts_ms),
            last_processed_ts_iso: `${r.last_processed_ts_iso}Z`,
        });
    }
    return map;
}

/**
 * Persist a checkpoint. `last_processed_ts_iso` must be ISO 8601 — full µs
 * precision recommended for data-walking passes so subsequent cycles can
 * lex-compare against trade timestamps without losing the sub-ms fraction.
 */
export async function setCursor(
    scope: string,
    last_cursor: string,
    last_processed_ts_iso: string,
): Promise<void> {
    // CH DateTime64('UTC') parses ISO 8601 with the trailing Z stripped.
    const persisted = last_processed_ts_iso.replace(/Z$/, '');
    await insertClient.insert({
        table: 'cursor_state',
        values: [{ scope, last_cursor, last_processed_ts: persisted }],
        format: 'JSONEachRow',
    });
    setScopeHeadTime(scope, last_processed_ts_iso);
}

/** True if `intervalSec` has elapsed since `lastMs` (or no prior run exists). */
export function isDue(
    lastMs: number | undefined,
    intervalSec: number,
): boolean {
    if (lastMs == null) return true;
    return Date.now() - lastMs >= intervalSec * 1000;
}

/** Stamp `scope` with `now`, empty cursor — for refresh-pass clocks. */
export function markRan(scope: string): Promise<void> {
    return setCursor(scope, '', new Date().toISOString());
}
