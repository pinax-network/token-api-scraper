import { getBatchInsertQueue } from '../lib/batch-insert';
import { createLogger } from '../lib/logger';
import { incrementError, incrementSuccess } from '../lib/prometheus';

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
export function handleInsertError(error: unknown, context: string): void {
    const err = error as ClickHouseError;
    const errorMessage = err?.message || String(error);
    const isConnectionError =
        err?.code === 'ConnectionRefused' ||
        errorMessage?.includes('Connection refused');

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
): Promise<boolean> {
    try {
        // Use batch insert queue
        const batchQueue = getBatchInsertQueue();
        await batchQueue.add(table, value);
        return true;
    } catch (error) {
        // Log error but don't throw - allows service to continue processing other items
        handleInsertError(error, context);
        return false;
    }
}

export async function insert_balances(
    row: {
        contract: string;
        account: string;
        balance_hex: string;
        block_num: number;
    },
    serviceName?: string,
) {
    const success = await insertRow(
        'erc20_balances_rpc',
        row,
        `Failed to insert balance for account ${row.account}`,
    );
    if (serviceName) {
        if (success) incrementSuccess(serviceName);
        else incrementError(serviceName);
    }
}

export async function insert_error_balances(
    row: { block_num: number; contract: string; account: string },
    error_msg: string,
    serviceName?: string,
) {
    await insertRow(
        'erc20_balances_rpc',
        { ...row, error_msg },
        `Failed to insert error balance for account ${row.account}`,
    );
    if (serviceName) {
        incrementError(serviceName);
    }
}

export async function insert_native_balances(
    row: {
        account: string;
        balance_hex: string;
    },
    serviceName?: string,
) {
    const success = await insertRow(
        'native_balances_rpc',
        row,
        `Failed to insert native balance for account ${row.account}`,
    );
    if (serviceName) {
        if (success) incrementSuccess(serviceName);
        else incrementError(serviceName);
    }
}

export async function insert_error_native_balances(
    account: string,
    error: string,
    serviceName?: string,
) {
    await insertRow(
        'native_balances_rpc',
        { account, error },
        `Failed to insert error native balance for account ${account}`,
    );
    if (serviceName) {
        incrementError(serviceName);
    }
}
