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

export const logger = new Logger({
    name: 'token-api-scraper',
    type: logType as 'pretty' | 'json' | 'hidden',
    minLevel,
});

export function createLogger(name: string): Logger<unknown> {
    return logger.getSubLogger({ name });
}
