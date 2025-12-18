import { Logger } from 'tslog';

const logLevel = parseInt(process.env.LOG_LEVEL || '3', 10);

export const logger = new Logger({
    name: 'token-api-scraper',
    type: 'pretty',
    minLevel: logLevel,
});

export function createLogger(name: string): Logger<unknown> {
    return logger.getSubLogger({ name });
}
