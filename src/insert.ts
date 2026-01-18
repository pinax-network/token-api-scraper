import { getBatchInsertQueue } from '../lib/batch-insert';
import { NODE_URL } from '../lib/config';
import { createLogger } from '../lib/logger';

const log = createLogger('insert');

/**
 * Interface for ClickHouse client errors
 */
interface ClickHouseError extends Error {
    code?: string;
    message: string;
}

/**
 * Helper function to handle insert errors consistently
 * Logs error details and provides specific guidance for connection issues
 */
export function handleInsertError(
    error: unknown,
    context: string,
    additionalContext?: {
        contract?: string;
        account?: string;
        rpcEndpoint?: string;
    },
): void {
    const err = error as ClickHouseError;
    const errorMessage = err?.message || String(error);
    const isConnectionError =
        err?.code === 'ConnectionRefused' ||
        errorMessage?.includes('Connection refused');

    // Emit warning for non-deterministic errors with retries
    log.warn('Insert operation failed - non-deterministic error', {
        context,
        message: errorMessage,
        code: err?.code,
        isConnectionError,
        contract: additionalContext?.contract,
        account: additionalContext?.account,
        rpcEndpoint: additionalContext?.rpcEndpoint || NODE_URL,
    });

    log.error('Insert operation failed', {
        context,
        message: errorMessage,
        code: err?.code,
        isConnectionError,
    });
}

/**
 * Insert a row into ClickHouse using batch insert
 * Returns true if successful, false if error
 */
export async function insertRow<T>(
    table: string,
    value: T,
    context: string,
    additionalContext?: {
        contract?: string;
        account?: string;
        rpcEndpoint?: string;
    },
): Promise<boolean> {
    try {
        // Use batch insert queue
        const batchQueue = getBatchInsertQueue();
        await batchQueue.add(table, value);
        return true;
    } catch (error) {
        // Log error but don't throw - allows service to continue processing other items
        handleInsertError(error, context, additionalContext);
        return false;
    }
}
