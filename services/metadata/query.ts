/**
 * EVM metadata query service - for troubleshooting single contract queries
 * Fetches token metadata (name, symbol, decimals) from ERC-20 contracts
 * with verbose debug logging to help understand each step of the query
 */

import {
    decodeNameHex,
    decodeNumberHex,
    decodeSymbolHex,
} from '../../lib/hex-decode';
import { callContract, getContractCode } from '../../lib/rpc';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

function header(text: string): void {
    console.log(`\n${BOLD}${CYAN}${'═'.repeat(80)}${RESET}`);
    console.log(`${BOLD}${CYAN}  ${text}${RESET}`);
    console.log(`${BOLD}${CYAN}${'═'.repeat(80)}${RESET}\n`);
}

function section(text: string): void {
    console.log(`\n${BOLD}${MAGENTA}${'─'.repeat(80)}${RESET}`);
    console.log(`${BOLD}${MAGENTA}  ${text}${RESET}`);
    console.log(`${BOLD}${MAGENTA}${'─'.repeat(80)}${RESET}\n`);
}

function info(text: string, data?: Record<string, unknown>): void {
    console.log(`${DIM}›${RESET} ${text}`);
    if (data) {
        for (const [key, value] of Object.entries(data)) {
            console.log(`    ${DIM}${key}:${RESET} ${value}`);
        }
    }
}

function success(text: string, data?: Record<string, unknown>): void {
    console.log(`${GREEN}✓${RESET} ${BOLD}${text}${RESET}`);
    if (data) {
        for (const [key, value] of Object.entries(data)) {
            console.log(`    ${DIM}${key}:${RESET} ${value}`);
        }
    }
}

function warn(text: string, data?: Record<string, unknown>): void {
    console.warn(`${YELLOW}⚠${RESET} ${YELLOW}${text}${RESET}`);
    if (data) {
        for (const [key, value] of Object.entries(data)) {
            console.warn(`    ${DIM}${key}:${RESET} ${value}`);
        }
    }
}

function error(text: string, data?: Record<string, unknown>): void {
    console.error(`${RED}✗${RESET} ${RED}${text}${RESET}`);
    if (data) {
        for (const [key, value] of Object.entries(data)) {
            console.error(`    ${DIM}${key}:${RESET} ${value}`);
        }
    }
}

// EVM address validation
const EVM_ADDRESS_REGEX = /^(0x)?[0-9a-fA-F]{40}$/;
// TRON base58 address validation (starts with T)
const TRON_ADDRESS_REGEX = /^T[0-9A-HJ-NP-Za-km-z]{33}$/;

// Contract code constant for self-destruct detection
const EMPTY_CONTRACT_CODE = '0x';

/**
 * Query metadata for a single EVM contract address with verbose logging
 * This is for troubleshooting to see if a single contract is functional at fetching its metadata
 *
 * @param contract - The contract address to query (EVM hex or TRON base58 format)
 */
export async function queryMetadata(contract: string): Promise<void> {
    header(`EVM Metadata Query: ${contract}`);

    // Step 1: Validate the contract address format
    section('Step 1: Validating contract address format');
    const isEvmAddress = EVM_ADDRESS_REGEX.test(contract);
    const isTronAddress = TRON_ADDRESS_REGEX.test(contract);

    if (!isEvmAddress && !isTronAddress) {
        error('Invalid contract address format', {
            contract,
            length: contract.length,
            expected:
                '0x-prefixed 40-char hex (EVM) or T-prefixed 34-char base58 (TRON)',
        });
        return;
    }

    success('Contract address format is valid', {
        contract,
        format: isEvmAddress ? 'EVM hex' : 'TRON base58',
    });

    // Step 2: Check if contract has code
    section('Step 2: Checking if contract has code');
    let hasCode = false;

    try {
        info('Fetching contract code via eth_getCode...');
        const code = await getContractCode(contract);

        if (code.toLowerCase() === EMPTY_CONTRACT_CODE) {
            warn('Contract has no code', {
                message:
                    'The contract may be self-destructed or address is incorrect',
            });
        } else {
            hasCode = true;
            success('Contract has code', {
                codeLength: code.length,
                codePreview:
                    code.slice(0, 66) + (code.length > 66 ? '...' : ''),
            });
        }
    } catch (err) {
        error('Failed to fetch contract code', {
            contract,
            error: (err as Error).message,
        });
    }

    // Step 3: Fetch decimals()
    section('Step 3: Fetching decimals()');
    let decimals: number | null = null;
    let decimalsRaw: string | null = null;

    try {
        info('Calling decimals() on contract...');
        decimalsRaw = await callContract(contract, 'decimals()');

        if (decimalsRaw) {
            decimals = decodeNumberHex(decimalsRaw);

            if (decimals !== null) {
                success('decimals() returned successfully', {
                    raw: decimalsRaw,
                    decoded: decimals,
                });
            } else {
                warn('decimals() returned invalid data', {
                    raw: decimalsRaw,
                    message: 'Could not decode as uint8',
                });
            }
        } else {
            warn('decimals() returned empty response', {
                message: 'Contract may not implement decimals()',
            });
        }
    } catch (err) {
        error('decimals() call failed', {
            contract,
            error: (err as Error).message,
        });
    }

    // Step 4: Fetch symbol()
    section('Step 4: Fetching symbol()');
    let symbol = '';
    let symbolRaw: string | null = null;

    try {
        info('Calling symbol() on contract...');
        symbolRaw = await callContract(contract, 'symbol()');

        if (symbolRaw) {
            symbol = decodeSymbolHex(symbolRaw);

            if (symbol) {
                success('symbol() returned successfully', {
                    raw:
                        symbolRaw.slice(0, 66) +
                        (symbolRaw.length > 66 ? '...' : ''),
                    decoded: symbol,
                });
            } else {
                info('symbol() returned empty or could not decode', {
                    raw:
                        symbolRaw.slice(0, 66) +
                        (symbolRaw.length > 66 ? '...' : ''),
                    message: 'This is allowed for ERC-20 tokens',
                });
            }
        } else {
            info('symbol() returned empty response', {
                message:
                    'Contract may not implement symbol() - this is optional',
            });
        }
    } catch (err) {
        info('symbol() call failed', {
            error: (err as Error).message,
            message: 'This is not a critical error - symbol() is optional',
        });
    }

    // Step 5: Fetch name()
    section('Step 5: Fetching name()');
    let name = '';
    let nameRaw: string | null = null;

    try {
        info('Calling name() on contract...');
        nameRaw = await callContract(contract, 'name()');

        if (nameRaw) {
            name = decodeNameHex(nameRaw);

            if (name) {
                success('name() returned successfully', {
                    raw:
                        nameRaw.slice(0, 66) +
                        (nameRaw.length > 66 ? '...' : ''),
                    decoded: name,
                });
            } else {
                info('name() returned empty or could not decode', {
                    raw:
                        nameRaw.slice(0, 66) +
                        (nameRaw.length > 66 ? '...' : ''),
                    message: 'This is allowed for ERC-20 tokens',
                });
            }
        } else {
            info('name() returned empty response', {
                message: 'Contract may not implement name() - this is optional',
            });
        }
    } catch (err) {
        info('name() call failed', {
            error: (err as Error).message,
            message: 'This is not a critical error - name() is optional',
        });
    }

    // Summary
    header('Query Summary');

    console.log(`  ${BOLD}Contract:${RESET}              ${contract}`);
    console.log(
        `  ${BOLD}Has code:${RESET}              ${hasCode ? `${GREEN}Yes${RESET}` : `${RED}No${RESET}`}`,
    );
    console.log(
        `  ${BOLD}decimals():${RESET}            ${decimals !== null ? `${GREEN}${decimals}${RESET}` : `${RED}Not available${RESET}`}`,
    );
    console.log(
        `  ${BOLD}symbol():${RESET}              ${symbol ? `${GREEN}${symbol}${RESET}` : `${DIM}(empty)${RESET}`}`,
    );
    console.log(
        `  ${BOLD}name():${RESET}                ${name ? `${GREEN}${name}${RESET}` : `${DIM}(empty)${RESET}`}`,
    );
    console.log();

    // Validation result
    if (decimals !== null) {
        console.log(
            `  ${BOLD}${GREEN}✓ Valid ERC-20 token${RESET} - decimals() is required and was found`,
        );
        if (!symbol && !name) {
            console.log(
                `  ${DIM}Note: This token has no name or symbol defined${RESET}`,
            );
        }
    } else if (!hasCode) {
        console.log(
            `  ${BOLD}${RED}✗ Invalid contract${RESET} - No code at this address (self-destructed or wrong address)`,
        );
    } else {
        console.log(
            `  ${BOLD}${RED}✗ Not a valid ERC-20 token${RESET} - decimals() is required but not available`,
        );
    }
    console.log();
}

/**
 * Run function for CLI integration
 * Takes the contract address from the command line arguments
 */
export async function run(contract: string): Promise<void> {
    if (!contract) {
        error('No contract address provided');
        process.exit(1);
    }

    await queryMetadata(contract);
}

// Run the service if this is the main module
if (import.meta.main) {
    const contract = process.argv[2];

    run(contract).catch((error) => {
        console.error('Service failed:', error);
        process.exit(1);
    });
}
