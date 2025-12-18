import { Logger } from 'tslog';

/**
 * Log level configuration
 * Uses standard LOG_LEVEL environment variable
 * Valid values: debug, info, warn, error
 * Default: info
 */
const LOG_LEVEL_MAP: Record<string, number> = {
    debug: 2,
    info: 3,
    warn: 4,
    error: 5,
};

const logLevelEnv = (process.env.LOG_LEVEL || 'info').toLowerCase();
const minLevel = LOG_LEVEL_MAP[logLevelEnv] ?? LOG_LEVEL_MAP.info;

/**
 * Main application logger instance
 * Configured with structured logging for production use
 */
export const logger = new Logger({
    name: 'token-api-scraper',
    minLevel,
    type: 'pretty',
    prettyLogTimeZone: 'local',
    prettyLogTemplate:
        '{{yyyy}}-{{mm}}-{{dd}} {{hh}}:{{MM}}:{{ss}} {{logLevelName}} [{{name}}] ',
});

/**
 * Create a child logger with a specific name/context
 * Useful for module-specific logging
 */
export function createLogger(name: string): Logger<unknown> {
    return logger.getSubLogger({ name });
}

// Export log level for reference
export const LOG_LEVEL = logLevelEnv;
