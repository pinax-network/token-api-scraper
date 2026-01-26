/**
 * Solana LP metadata query service - for troubleshooting LP token detection
 * Attempts to derive LP token metadata using heavier RPC calls (like getProgramAccounts)
 * with verbose debug logging to help understand each step of the query
 */

import {
    deriveMeteoraDlmmLpMetadata,
    derivePumpAmmLpMetadata,
    deriveRaydiumLpMetadata,
    isMeteoraDlmmLpToken,
    isPumpAmmLpToken,
    isRaydiumAmmLpToken,
    METEORA_DLMM_PROGRAM_ID,
    PUMP_AMM_PROGRAM_ID,
    RAYDIUM_AMM_PROGRAM_ID,
    RAYDIUM_CPMM_PROGRAM_ID,
} from '../../lib/solana-rpc';

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

// Solana base58 address length constraints
const MIN_BASE58_ADDRESS_LENGTH = 32;
const MAX_BASE58_ADDRESS_LENGTH = 44;

/**
 * Query LP metadata for a single Solana mint address with verbose logging
 * This is for troubleshooting to see if a single mint is an LP token and can have metadata derived
 *
 * @param mint - The mint address to query
 */
export async function queryLpMetadata(mint: string): Promise<void> {
    header(`Solana LP Metadata Query: ${mint}`);

    // Step 1: Validate the mint address format
    section('Step 1: Validating mint address format');
    try {
        // Basic validation - should be a base58 string of reasonable length
        if (
            !mint ||
            mint.length < MIN_BASE58_ADDRESS_LENGTH ||
            mint.length > MAX_BASE58_ADDRESS_LENGTH
        ) {
            error('Invalid mint address length', {
                mint,
                length: mint.length,
                expected: `${MIN_BASE58_ADDRESS_LENGTH}-${MAX_BASE58_ADDRESS_LENGTH} characters`,
            });
            return;
        }
        success('Mint address format looks valid', {
            mint,
            length: mint.length,
        });
    } catch (err) {
        error('Failed to validate mint address', {
            mint,
            error: (err as Error).message,
        });
        return;
    }

    // Step 2: Check if this is a Pump.fun AMM LP token
    section('Step 2: Checking for Pump.fun AMM LP Token');

    let pumpAmmLpMetadata: { name: string; symbol: string } | null = null;
    let isPumpAmmLp = false;

    try {
        info('Checking mint authority ownership by Pump.fun AMM program...');
        const lpCheck = await isPumpAmmLpToken(mint);

        if (lpCheck.isLpToken && lpCheck.poolAddress) {
            isPumpAmmLp = true;
            success('This is a Pump.fun AMM LP token', {
                poolAddress: lpCheck.poolAddress,
                pumpAmmProgram: PUMP_AMM_PROGRAM_ID,
            });

            // Derive LP metadata from pool
            info('Deriving LP token metadata from pool...');
            pumpAmmLpMetadata = await derivePumpAmmLpMetadata(
                lpCheck.poolAddress,
            );

            if (pumpAmmLpMetadata) {
                success('Derived LP token metadata from pool', {
                    derivedName: pumpAmmLpMetadata.name,
                    derivedSymbol: pumpAmmLpMetadata.symbol,
                });
            } else {
                warn('Could not derive LP metadata from pool');
            }
        } else {
            info('Not a Pump.fun AMM LP token', {
                message: 'Mint authority is not owned by Pump.fun AMM program',
            });
        }
    } catch (err) {
        error('Error checking for Pump.fun AMM LP token', {
            error: (err as Error).message,
        });
    }

    // Step 3: Check if this is a Meteora DLMM LP token
    section('Step 3: Checking for Meteora DLMM LP Token');

    let meteoraDlmmLpMetadata: { name: string; symbol: string } | null = null;
    let isMeteoraDlmmLp = false;

    try {
        info('Checking mint authority ownership by Meteora DLMM program...');
        const lpCheck = await isMeteoraDlmmLpToken(mint);

        if (lpCheck.isLpToken && lpCheck.poolAddress) {
            isMeteoraDlmmLp = true;
            success('This is a Meteora DLMM LP token', {
                poolAddress: lpCheck.poolAddress,
                meteoraDlmmProgram: METEORA_DLMM_PROGRAM_ID,
            });

            // Derive LP metadata from pool
            info('Deriving LP token metadata from pool...');
            meteoraDlmmLpMetadata = await deriveMeteoraDlmmLpMetadata(
                lpCheck.poolAddress,
            );

            if (meteoraDlmmLpMetadata) {
                success('Derived LP token metadata from pool', {
                    derivedName: meteoraDlmmLpMetadata.name,
                    derivedSymbol: meteoraDlmmLpMetadata.symbol,
                });
            } else {
                warn('Could not derive LP metadata from pool');
            }
        } else {
            info('Not a Meteora DLMM LP token', {
                message: 'Mint authority is not owned by Meteora DLMM program',
            });
        }
    } catch (err) {
        error('Error checking for Meteora DLMM LP token', {
            error: (err as Error).message,
        });
    }

    // Step 4: Check if this is a Raydium LP token (AMM V4 or CPMM)
    section('Step 4: Checking for Raydium LP Token (AMM V4 / CPMM)');

    let raydiumLpMetadata: { name: string; symbol: string } | null = null;
    let isRaydiumLp = false;
    let raydiumPoolType: 'amm-v4' | 'cpmm' | null = null;

    try {
        info('Checking mint authority against Raydium authorities...');
        info('Note: This may use getProgramAccounts which is a heavy RPC call');
        const lpCheck = await isRaydiumAmmLpToken(mint);

        if (lpCheck.isLpToken && lpCheck.poolType) {
            isRaydiumLp = true;
            raydiumPoolType = lpCheck.poolType;
            success(
                `This is a Raydium ${lpCheck.poolType.toUpperCase()} LP token`,
                {
                    poolAddress:
                        lpCheck.poolAddress ??
                        'Not found (pool search timed out)',
                    poolType: lpCheck.poolType,
                    raydiumProgram:
                        lpCheck.poolType === 'amm-v4'
                            ? RAYDIUM_AMM_PROGRAM_ID
                            : RAYDIUM_CPMM_PROGRAM_ID,
                },
            );

            // Derive LP metadata from pool (only if we found the pool address)
            if (lpCheck.poolAddress) {
                info('Deriving LP token metadata from pool...');
                raydiumLpMetadata = await deriveRaydiumLpMetadata(
                    lpCheck.poolAddress,
                    lpCheck.poolType,
                );

                if (raydiumLpMetadata) {
                    success('Derived LP token metadata from pool', {
                        derivedName: raydiumLpMetadata.name,
                        derivedSymbol: raydiumLpMetadata.symbol,
                    });
                } else {
                    warn('Could not derive LP metadata from pool');
                }
            } else {
                warn('Pool address not found - using generic LP metadata', {
                    genericName: `Raydium ${lpCheck.poolType.toUpperCase()} LP`,
                    genericSymbol: 'RAY-LP',
                });
            }
        } else {
            info('Not a Raydium LP token', {
                message:
                    'Mint authority does not match any known Raydium authority',
            });
        }
    } catch (err) {
        error('Error checking for Raydium LP token', {
            error: (err as Error).message,
        });
    }

    // Summary
    header('Query Summary');

    const isLpToken = isPumpAmmLp || isMeteoraDlmmLp || isRaydiumLp;

    console.log(`  ${BOLD}Mint:${RESET}                  ${mint}`);
    console.log(
        `  ${BOLD}Is LP Token:${RESET}           ${isLpToken ? `${GREEN}Yes${RESET}` : `${DIM}No${RESET}`}`,
    );
    console.log();

    if (isPumpAmmLp) {
        console.log(
            `  ${BOLD}${GREEN}Pump.fun AMM LP Token${RESET} ${GREEN}✓${RESET}`,
        );
        if (pumpAmmLpMetadata) {
            console.log(
                `    ${BOLD}Name:${RESET}   ${pumpAmmLpMetadata.name || `${DIM}(empty)${RESET}`}`,
            );
            console.log(
                `    ${BOLD}Symbol:${RESET} ${pumpAmmLpMetadata.symbol || `${DIM}(empty)${RESET}`}`,
            );
            console.log(`    ${BOLD}Source:${RESET} pump-amm`);
        }
        console.log();
    }

    if (isMeteoraDlmmLp) {
        console.log(
            `  ${BOLD}${GREEN}Meteora DLMM LP Token${RESET} ${GREEN}✓${RESET}`,
        );
        if (meteoraDlmmLpMetadata) {
            console.log(
                `    ${BOLD}Name:${RESET}   ${meteoraDlmmLpMetadata.name || `${DIM}(empty)${RESET}`}`,
            );
            console.log(
                `    ${BOLD}Symbol:${RESET} ${meteoraDlmmLpMetadata.symbol || `${DIM}(empty)${RESET}`}`,
            );
            console.log(`    ${BOLD}Source:${RESET} meteora-dlmm`);
        }
        console.log();
    }

    if (isRaydiumLp) {
        console.log(
            `  ${BOLD}${GREEN}Raydium ${raydiumPoolType?.toUpperCase()} LP Token${RESET} ${GREEN}✓${RESET}`,
        );
        if (raydiumLpMetadata) {
            console.log(
                `    ${BOLD}Name:${RESET}   ${raydiumLpMetadata.name || `${DIM}(empty)${RESET}`}`,
            );
            console.log(
                `    ${BOLD}Symbol:${RESET} ${raydiumLpMetadata.symbol || `${DIM}(empty)${RESET}`}`,
            );
        } else if (raydiumPoolType) {
            console.log(
                `    ${BOLD}Name:${RESET}   Raydium ${raydiumPoolType.toUpperCase()} LP`,
            );
            console.log(`    ${BOLD}Symbol:${RESET} RAY-LP`);
        }
        console.log(`    ${BOLD}Source:${RESET} raydium`);
        console.log();
    }

    if (!isLpToken) {
        warn('No LP token metadata found', {
            message:
                'This mint is not recognized as a Pump.fun, Meteora, or Raydium LP token',
        });
        info('This mint may have standard metadata instead', {
            suggestion: 'Try running: query metadata-solana ' + mint,
        });
    }
}

/**
 * Run function for CLI integration
 * Takes the mint address from the command line arguments
 */
export async function run(mint: string): Promise<void> {
    if (!mint) {
        error('No mint address provided');
        process.exit(1);
    }

    await queryLpMetadata(mint);
}

// Run the service if this is the main module
if (import.meta.main) {
    const mint = process.argv[2];

    run(mint).catch((error) => {
        console.error('Service failed:', error);
        process.exit(1);
    });
}
