/**
 * Solana metadata query service - for troubleshooting single token queries
 * Fetches token metadata from Metaplex Token Metadata or Token-2022 extensions
 * with verbose debug logging to help understand each step of the query
 */

import {
    decodeMetaplexMetadata,
    derivePumpAmmLpMetadata,
    findMetadataPda,
    getAccountInfo,
    isPumpAmmLpToken,
    METAPLEX_PROGRAM_ID,
    PUMP_AMM_PROGRAM_ID,
    parseToken2022Extensions,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
} from '../../lib/solana-rpc';
import { fetchUriMetadata } from '../../lib/uri-fetch';

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
 * Query metadata for a single Solana mint address with verbose logging
 * This is for troubleshooting to see if a single contract is functional at fetching its metadata
 *
 * @param mint - The mint address to query
 * @param programId - Optional program ID override (TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID)
 */
export async function queryMetadata(
    mint: string,
    programId?: string,
): Promise<void> {
    header(`Solana Metadata Query: ${mint}`);

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

    // Step 2: Get mint account info to determine program type
    section('Step 2: Fetching mint account info');
    let mintAccountInfo = null;
    let detectedProgramId = programId;

    try {
        mintAccountInfo = await getAccountInfo(mint);

        if (!mintAccountInfo) {
            warn('Mint account not found', {
                mint,
                message: 'The mint account does not exist or has been closed',
            });
        } else {
            success('Mint account found', {
                owner: mintAccountInfo.owner,
                lamports: mintAccountInfo.lamports,
                dataLength: mintAccountInfo.data?.length || 0,
                executable: mintAccountInfo.executable,
                rentEpoch: mintAccountInfo.rentEpoch,
            });

            // Detect program type based on account owner
            detectedProgramId = mintAccountInfo.owner;
            const isToken2022 = detectedProgramId === TOKEN_2022_PROGRAM_ID;
            const isStandardSPL = detectedProgramId === TOKEN_PROGRAM_ID;

            info('Detected token program', {
                programId: detectedProgramId,
                programType: isToken2022
                    ? 'Token-2022 (Token Extensions)'
                    : isStandardSPL
                      ? 'Standard SPL Token'
                      : 'Unknown',
            });
        }
    } catch (err) {
        error('Failed to fetch mint account info', {
            mint,
            error: (err as Error).message,
        });
    }

    // Step 2.5: Check if this is a Pump.fun AMM LP token
    section('Step 2.5: Checking for Pump.fun AMM LP Token');

    let pumpAmmLpMetadata: { name: string; symbol: string } | null = null;
    let isPumpAmmLp = false;

    try {
        const lpCheck = await isPumpAmmLpToken(mint);

        if (lpCheck.isLpToken && lpCheck.poolAddress) {
            isPumpAmmLp = true;
            success('This is a Pump.fun AMM LP token', {
                poolAddress: lpCheck.poolAddress,
                pumpAmmProgram: PUMP_AMM_PROGRAM_ID,
            });

            // Derive LP metadata from pool
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
        info('Could not check for Pump.fun AMM LP token', {
            error: (err as Error).message,
        });
    }

    // Step 3: Try Metaplex metadata
    section('Step 3: Looking up Metaplex Token Metadata');

    let metaplexFound = false;
    try {
        const metadataPda = findMetadataPda(mint);
        info('Computed Metaplex metadata PDA', {
            metadataPda,
            metaplexProgramId: METAPLEX_PROGRAM_ID,
        });

        const accountInfo = await getAccountInfo(metadataPda);

        if (!accountInfo) {
            info('No Metaplex metadata account found at PDA', {
                message: 'This token may not have Metaplex metadata registered',
            });
        } else {
            info('Metaplex metadata account found', {
                dataLength: accountInfo.data?.length || 0,
                owner: accountInfo.owner,
                lamports: accountInfo.lamports,
            });

            // Try to decode the metadata
            if (accountInfo.data) {
                info('Attempting to decode Metaplex metadata...');

                const metadata = decodeMetaplexMetadata(accountInfo.data);

                if (metadata) {
                    metaplexFound = true;

                    success('Decoded Metaplex metadata', {
                        name: metadata.name || '(empty)',
                        symbol: metadata.symbol || '(empty)',
                        uri: metadata.uri || '(empty)',
                        sellerFeeBasisPoints: metadata.sellerFeeBasisPoints,
                        primarySaleHappened: metadata.primarySaleHappened,
                        isMutable: metadata.isMutable,
                    });
                } else {
                    warn('Failed to decode Metaplex metadata', {
                        message: 'Account exists but data could not be parsed',
                        dataLengthBytes: accountInfo.data.length,
                    });
                }
            } else {
                warn('Metaplex account has no data');
            }
        }
    } catch (err) {
        error('Error during Metaplex metadata lookup', {
            mint,
            error: (err as Error).message,
        });
    }

    // Step 4: Try Token-2022 extensions (if applicable)
    section('Step 4: Checking for Token-2022 metadata extension');

    const isToken2022Program = detectedProgramId === TOKEN_2022_PROGRAM_ID;
    let token2022Found = false;

    if (!isToken2022Program) {
        info('Skipping Token-2022 extension lookup - not a Token-2022 token', {
            detectedProgramId,
            token2022ProgramId: TOKEN_2022_PROGRAM_ID,
        });
    } else if (!mintAccountInfo) {
        warn(
            'Cannot check Token-2022 extensions - mint account info not available',
        );
    } else {
        info('Token is a Token-2022 token, checking for metadata extension');

        try {
            if (mintAccountInfo.data) {
                info('Parsing Token-2022 extensions from mint account data', {
                    dataLength: mintAccountInfo.data.length,
                });

                const token2022Metadata = parseToken2022Extensions(
                    mintAccountInfo.data,
                    mintAccountInfo.owner,
                );

                if (token2022Metadata) {
                    token2022Found = true;
                    success('Found Token-2022 metadata extension', {
                        name: token2022Metadata.name || '(empty)',
                        symbol: token2022Metadata.symbol || '(empty)',
                        uri: token2022Metadata.uri || '(empty)',
                    });
                } else {
                    info('No Token-2022 metadata extension found', {
                        message:
                            'The Token-2022 mint does not have the TOKEN_METADATA extension',
                    });
                }
            } else {
                warn('Mint account has no data to parse for extensions');
            }
        } catch (err) {
            error('Error parsing Token-2022 extensions', {
                mint,
                error: (err as Error).message,
            });
        }
    }

    // Step 5: Fetch URI metadata (if URI is available)
    section('Step 5: Fetching URI metadata');

    // Collect URI from whichever source found it
    let onChainName = '';
    let onChainSymbol = '';
    let onChainUri = '';

    if (metaplexFound) {
        // Re-fetch metaplex to get values (we already decoded above)
        const metadataPda = findMetadataPda(mint);
        const accountInfo = await getAccountInfo(metadataPda);
        if (accountInfo?.data) {
            const metadata = decodeMetaplexMetadata(accountInfo.data);
            if (metadata) {
                onChainName = metadata.name || '';
                onChainSymbol = metadata.symbol || '';
                onChainUri = metadata.uri || '';
            }
        }
    } else if (token2022Found && mintAccountInfo?.data) {
        const token2022Metadata = parseToken2022Extensions(
            mintAccountInfo.data,
            mintAccountInfo.owner,
        );
        if (token2022Metadata) {
            onChainName = token2022Metadata.name || '';
            onChainSymbol = token2022Metadata.symbol || '';
            onChainUri = token2022Metadata.uri || '';
        }
    }

    let uriName = '';
    let uriSymbol = '';
    let uriDescription = '';
    let uriImage = '';
    let uriFound = false;

    if (onChainUri) {
        info('Fetching metadata from URI', { uri: onChainUri });

        try {
            const uriResult = await fetchUriMetadata(onChainUri);

            if (uriResult.success && uriResult.metadata) {
                uriFound = true;
                uriName = uriResult.metadata.name || '';
                uriSymbol = uriResult.metadata.symbol || '';
                uriDescription = uriResult.metadata.description || '';
                uriImage = uriResult.metadata.image || '';

                success('URI metadata fetched', {
                    name: uriName || '(empty)',
                    symbol: uriSymbol || '(empty)',
                    description: uriDescription
                        ? uriDescription.slice(0, 100) +
                          (uriDescription.length > 100 ? '...' : '')
                        : '(empty)',
                    image: uriImage || '(empty)',
                });
            } else {
                warn('Failed to fetch URI metadata', {
                    uri: onChainUri,
                    error: uriResult.error,
                });
            }
        } catch (err) {
            error('Error fetching URI metadata', {
                uri: onChainUri,
                error: (err as Error).message,
            });
        }
    } else {
        info('No URI available to fetch metadata from');
    }

    // Final values: URI takes precedence over on-chain, Pump.fun AMM LP takes precedence for LP tokens
    let finalName = uriName || onChainName;
    let finalSymbol = uriSymbol || onChainSymbol;

    // For Pump.fun AMM LP tokens, use derived metadata if available
    if (isPumpAmmLp && pumpAmmLpMetadata) {
        finalName = pumpAmmLpMetadata.name;
        finalSymbol = pumpAmmLpMetadata.symbol;
    }

    // Summary
    header('Query Summary');

    const programType =
        detectedProgramId === TOKEN_2022_PROGRAM_ID
            ? 'Token-2022'
            : detectedProgramId === TOKEN_PROGRAM_ID
              ? 'Standard SPL Token'
              : 'Unknown';

    console.log(`  ${BOLD}Mint:${RESET}                  ${mint}`);
    console.log(
        `  ${BOLD}Account exists:${RESET}        ${mintAccountInfo !== null ? `${GREEN}Yes${RESET}` : `${RED}No${RESET}`}`,
    );
    console.log(`  ${BOLD}Program:${RESET}               ${programType}`);
    console.log(
        `  ${BOLD}Pump.fun AMM LP:${RESET}       ${isPumpAmmLp ? `${GREEN}Yes${RESET}` : `${DIM}No${RESET}`}`,
    );
    console.log(
        `  ${BOLD}Metaplex metadata:${RESET}     ${metaplexFound ? `${GREEN}Found${RESET}` : `${DIM}Not found${RESET}`}`,
    );
    console.log(
        `  ${BOLD}Token-2022 metadata:${RESET}   ${token2022Found ? `${GREEN}Found${RESET}` : isToken2022Program ? `${DIM}Not found${RESET}` : `${DIM}N/A${RESET}`}`,
    );
    console.log(
        `  ${BOLD}URI metadata:${RESET}          ${uriFound ? `${GREEN}Found${RESET}` : onChainUri ? `${DIM}Not found${RESET}` : `${DIM}No URI${RESET}`}`,
    );
    console.log();

    // Final resolved values
    if (finalName || finalSymbol) {
        const precedenceSource =
            isPumpAmmLp && pumpAmmLpMetadata
                ? 'Pump.fun AMM LP derived'
                : 'URI takes precedence';
        console.log(
            `  ${BOLD}${CYAN}Final Values (${precedenceSource}):${RESET}`,
        );
        console.log(
            `  ${BOLD}Name:${RESET}                  ${finalName || `${DIM}(empty)${RESET}`}`,
        );
        console.log(
            `  ${BOLD}Symbol:${RESET}                ${finalSymbol || `${DIM}(empty)${RESET}`}`,
        );
        if (uriDescription && !isPumpAmmLp) {
            console.log(
                `  ${BOLD}Description:${RESET}           ${uriDescription.slice(0, 60)}${uriDescription.length > 60 ? '...' : ''}`,
            );
        }
        if (uriImage && !isPumpAmmLp) {
            console.log(`  ${BOLD}Image:${RESET}                 ${uriImage}`);
        }
        console.log();
    }

    if (!mintAccountInfo) {
        warn('Check if the mint address is correct and exists on the network');
    } else if (!metaplexFound && !token2022Found) {
        warn('No metadata found');
    }
}

/**
 * Run function for CLI integration
 * Takes the mint address from the command line arguments
 */
export async function run(mint: string, programId?: string): Promise<void> {
    if (!mint) {
        error('No mint address provided');
        process.exit(1);
    }

    await queryMetadata(mint, programId);
}

// Run the service if this is the main module
if (import.meta.main) {
    const mint = process.argv[2];
    const programId = process.argv[3];

    run(mint, programId).catch((error) => {
        console.error('Service failed:', error);
        process.exit(1);
    });
}
