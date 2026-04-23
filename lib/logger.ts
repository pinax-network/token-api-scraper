import { Logger } from 'tslog';

const LOG_LEVEL_MAP: Record<string, number> = {
    debug: 2,
    info: 3,
    warn: 4,
    error: 5,
};

const logType = process.env.LOG_TYPE || 'pretty';
const logLevelEnv = (process.env.LOG_LEVEL || 'info').toLowerCase();
const minLevel = LOG_LEVEL_MAP[logLevelEnv] ?? LOG_LEVEL_MAP.info;

/**
 * Emit flat single-line JSON (level/time/logger/msg/…fields) instead of
 * tslog's default `{"0": msg, "1": payload, "_meta": {...source paths...}}`.
 * Kubernetes log aggregators and grep-style tools parse the flat shape; the
 * nested `_meta` with file paths inflated every line and was hard to query.
 */
function transportJSON(logObj: Record<string, unknown>): void {
    const meta = (logObj._meta || {}) as Record<string, unknown>;
    const { _meta, ...rest } = logObj;
    const indexed: Record<string, unknown> = rest;
    const msg = indexed[0];
    const payload = indexed[1];
    // Spread payload fields first so reserved keys (level/time/logger/msg)
    // set afterwards take precedence over any caller-supplied collisions.
    const payloadFields =
        payload && typeof payload === 'object'
            ? (payload as Record<string, unknown>)
            : {};
    const flat: Record<string, unknown> = {
        ...payloadFields,
        level: String(meta.logLevelName || 'info').toLowerCase(),
        time: meta.date,
        logger: meta.name,
        msg,
    };
    if (payload !== undefined && (payload === null || typeof payload !== 'object')) {
        flat.data = payload;
    }
    process.stdout.write(JSON.stringify(flat) + '\n');
}

export const logger = new Logger({
    name: 'token-api-scraper',
    type: logType as 'pretty' | 'json' | 'hidden',
    minLevel,
    overwrite: logType === 'json' ? { transportJSON } : undefined,
});

export function createLogger(name: string): Logger<unknown> {
    return logger.getSubLogger({ name });
}
