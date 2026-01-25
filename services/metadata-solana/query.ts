/**
 * Solana metadata query service - for troubleshooting single token queries
 * Fetches token metadata from Metaplex Token Metadata or Token-2022 extensions
 * with verbose debug logging to help understand each step of the query
 */

import { createLogger } from '../../lib/logger';
import {
    decodeMetaplexMetadata,
    findMetadataPda,
    getAccountInfo,
    isNftTokenStandard,
    METAPLEX_PROGRAM_ID,
    parseToken2022Extensions,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    TokenStandard,
} from '../../lib/solana-rpc';

const serviceName = 'metadata-solana-query';
const log = createLogger(serviceName);

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
    log.info('='.repeat(80));
    log.info('Starting Solana metadata query', { mint });
    log.info('='.repeat(80));

    // Step 1: Validate the mint address format
    log.info('Step 1: Validating mint address format');
    try {
        // Basic validation - should be a base58 string of reasonable length
        if (
            !mint ||
            mint.length < MIN_BASE58_ADDRESS_LENGTH ||
            mint.length > MAX_BASE58_ADDRESS_LENGTH
        ) {
            log.error('Invalid mint address length', {
                mint,
                length: mint.length,
                expected: `${MIN_BASE58_ADDRESS_LENGTH}-${MAX_BASE58_ADDRESS_LENGTH} characters`,
            });
            return;
        }
        log.info('Mint address format looks valid', {
            mint,
            length: mint.length,
        });
    } catch (error) {
        log.error('Failed to validate mint address', {
            mint,
            error: (error as Error).message,
        });
        return;
    }

    // Step 2: Get mint account info to determine program type
    log.info('-'.repeat(80));
    log.info('Step 2: Fetching mint account info to determine program type');
    let mintAccountInfo = null;
    let detectedProgramId = programId;

    try {
        mintAccountInfo = await getAccountInfo(mint);

        if (!mintAccountInfo) {
            log.warn('Mint account not found', {
                mint,
                message:
                    'The mint account does not exist or has been closed on the blockchain',
            });
        } else {
            log.info('Mint account found', {
                mint,
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

            log.info('Detected token program', {
                programId: detectedProgramId,
                isToken2022,
                isStandardSPL,
                programName: isToken2022
                    ? 'Token-2022 (Token Extensions)'
                    : isStandardSPL
                      ? 'Standard SPL Token'
                      : 'Unknown',
            });
        }
    } catch (error) {
        log.error('Failed to fetch mint account info', {
            mint,
            error: (error as Error).message,
        });
    }

    // Step 3: Try Metaplex metadata
    log.info('-'.repeat(80));
    log.info('Step 3: Looking up Metaplex Token Metadata');

    let metaplexFound = false;
    try {
        const metadataPda = findMetadataPda(mint);
        log.info('Computed Metaplex metadata PDA', {
            mint,
            metadataPda,
            metaplexProgramId: METAPLEX_PROGRAM_ID,
        });

        const accountInfo = await getAccountInfo(metadataPda);

        if (!accountInfo) {
            log.info('No Metaplex metadata account found at PDA', {
                metadataPda,
                message: 'This token may not have Metaplex metadata registered',
            });
        } else {
            log.info('Metaplex metadata account found', {
                metadataPda,
                dataLength: accountInfo.data?.length || 0,
                owner: accountInfo.owner,
                lamports: accountInfo.lamports,
            });

            // Try to decode the metadata
            if (accountInfo.data) {
                log.info('Attempting to decode Metaplex metadata...');

                const metadata = decodeMetaplexMetadata(accountInfo.data);

                if (metadata) {
                    metaplexFound = true;
                    const tokenStandardName =
                        metadata.tokenStandard !== null
                            ? TokenStandard[metadata.tokenStandard]
                            : 'null (not set)';
                    const isNft =
                        metadata.tokenStandard !== null &&
                        isNftTokenStandard(metadata.tokenStandard);

                    log.info('✓ Successfully decoded Metaplex metadata', {
                        name: metadata.name || '(empty)',
                        symbol: metadata.symbol || '(empty)',
                        uri: metadata.uri || '(empty)',
                        tokenStandard: metadata.tokenStandard,
                        tokenStandardName,
                        sellerFeeBasisPoints: metadata.sellerFeeBasisPoints,
                        primarySaleHappened: metadata.primarySaleHappened,
                        isMutable: metadata.isMutable,
                        isNft,
                    });

                    if (isNft) {
                        log.warn('Token is detected as an NFT', {
                            tokenStandardName,
                            message:
                                'This token would be skipped in the main metadata-solana service',
                        });
                    }
                } else {
                    log.warn('Failed to decode Metaplex metadata', {
                        message:
                            'Account exists but data could not be parsed as Metaplex metadata',
                        dataLengthBytes: accountInfo.data.length,
                    });
                }
            } else {
                log.warn('Metaplex account has no data', {
                    metadataPda,
                });
            }
        }
    } catch (error) {
        log.error('Error during Metaplex metadata lookup', {
            mint,
            error: (error as Error).message,
        });
    }

    // Step 4: Try Token-2022 extensions (if applicable)
    log.info('-'.repeat(80));
    log.info('Step 4: Checking for Token-2022 metadata extension');

    const isToken2022Program = detectedProgramId === TOKEN_2022_PROGRAM_ID;

    if (!isToken2022Program) {
        log.info(
            'Skipping Token-2022 extension lookup - not a Token-2022 token',
            {
                detectedProgramId,
                token2022ProgramId: TOKEN_2022_PROGRAM_ID,
                message:
                    'Token-2022 extensions are only available for tokens created with the Token-2022 program',
            },
        );
    } else if (!mintAccountInfo) {
        log.warn(
            'Cannot check Token-2022 extensions - mint account info not available',
        );
    } else {
        log.info(
            'Token is a Token-2022 token, checking for metadata extension',
        );

        try {
            if (mintAccountInfo.data) {
                log.info(
                    'Parsing Token-2022 extensions from mint account data',
                    {
                        dataLength: mintAccountInfo.data.length,
                    },
                );

                const token2022Metadata = parseToken2022Extensions(
                    mintAccountInfo.data,
                    mintAccountInfo.owner,
                );

                if (token2022Metadata) {
                    log.info('✓ Found Token-2022 metadata extension', {
                        name: token2022Metadata.name || '(empty)',
                        symbol: token2022Metadata.symbol || '(empty)',
                        uri: token2022Metadata.uri || '(empty)',
                    });
                } else {
                    log.info('No Token-2022 metadata extension found', {
                        message:
                            'The Token-2022 mint does not have the TOKEN_METADATA extension',
                    });
                }
            } else {
                log.warn('Mint account has no data to parse for extensions');
            }
        } catch (error) {
            log.error('Error parsing Token-2022 extensions', {
                mint,
                error: (error as Error).message,
            });
        }
    }

    // Summary
    log.info('='.repeat(80));
    log.info('Query Summary');
    log.info('='.repeat(80));

    const summary = {
        mint,
        accountExists: mintAccountInfo !== null,
        programId: detectedProgramId || 'unknown',
        programType:
            detectedProgramId === TOKEN_2022_PROGRAM_ID
                ? 'Token-2022'
                : detectedProgramId === TOKEN_PROGRAM_ID
                  ? 'Standard SPL Token'
                  : 'Unknown',
        metaplexMetadataFound: metaplexFound,
        isToken2022: isToken2022Program,
    };

    log.info('Final summary', summary);

    if (!mintAccountInfo) {
        log.warn(
            'Recommendation: Check if the mint address is correct and exists on the network',
        );
    } else if (!metaplexFound && !isToken2022Program) {
        log.info(
            'No metadata found - this token has no Metaplex metadata and is not a Token-2022 token',
        );
    } else if (!metaplexFound && isToken2022Program) {
        log.info(
            'No metadata found - this Token-2022 token has neither Metaplex metadata nor TOKEN_METADATA extension',
        );
    }
}

/**
 * Run function for CLI integration
 * Takes the mint address from the command line arguments
 */
export async function run(mint: string, programId?: string): Promise<void> {
    if (!mint) {
        log.error('No mint address provided');
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
