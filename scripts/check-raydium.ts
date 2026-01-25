/**
 * Debug script to understand Raydium AMM LP token detection
 */

import { PublicKey } from '@solana/web3.js';
import {
    base58Decode,
    base58Encode,
    getAccountInfo,
    getProgramAccounts,
} from '../lib/solana-rpc';

const RAYDIUM_AMM_PROGRAM_ID = new PublicKey(
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
);
const AUTHORITY_SEED = Buffer.from('amm authority');

// Test Raydium LP token
const TEST_LP_MINT = 'G3BMG2CmwcNVXuc6SDtW4UpcPBnpThJKtk3cysdTsHf1';

async function main() {
    console.log('Checking Raydium LP token:', TEST_LP_MINT);

    // Get mint account to see the mint authority
    const mintAccount = await getAccountInfo(TEST_LP_MINT);
    if (!mintAccount?.data) {
        console.log('Mint not found');
        return;
    }
    const buffer = Buffer.from(mintAccount.data, 'base64');
    const hasAuthority = buffer.readUInt32LE(0) === 1;
    const mintAuthority = hasAuthority
        ? base58Encode(buffer.subarray(4, 36))
        : null;

    if (!mintAuthority) {
        console.log('No mint authority');
        return;
    }

    console.log('Mint authority:', mintAuthority);
    console.log('');

    // Try to find the nonce that produces this authority
    console.log(
        'Searching for matching PDA (v4 format: [amm authority, nonce])...',
    );

    for (let nonce = 255; nonce >= 0; nonce--) {
        try {
            const pda = PublicKey.createProgramAddressSync(
                [AUTHORITY_SEED, Buffer.from([nonce])],
                RAYDIUM_AMM_PROGRAM_ID,
            );

            if (pda.toBase58() === mintAuthority) {
                console.log(`✅ FOUND MATCH! Nonce: ${nonce}`);
                console.log(`   PDA: ${pda.toBase58()}`);
                return;
            }

            if (nonce >= 252) {
                console.log(`Nonce ${nonce}: ${pda.toBase58()}`);
            }
        } catch (_e) {
            // Invalid PDA for this nonce (point is on curve)
            if (nonce >= 252) {
                console.log(`Nonce ${nonce}: invalid (on curve)`);
            }
        }
    }

    console.log('');
    console.log('❌ No matching PDA found for any nonce 0-255');
    console.log('Target:', mintAuthority);

    // Let's also try find_program_address
    const [standardPda, bump] = PublicKey.findProgramAddressSync(
        [AUTHORITY_SEED],
        RAYDIUM_AMM_PROGRAM_ID,
    );
    console.log('');
    console.log('Standard PDA (single seed):');
    console.log(`  PDA: ${standardPda.toBase58()}`);
    console.log(`  Bump: ${bump}`);
    console.log(`  Match: ${standardPda.toBase58() === mintAuthority}`);

    // Try to find the pool account that has this LP mint
    console.log('');
    console.log('Searching for pool account with this LP mint...');

    // LP mint is at offset 472 in the pool account
    const _lpMintBytes = base58Decode(TEST_LP_MINT);
    const pools = await getProgramAccounts(RAYDIUM_AMM_PROGRAM_ID.toBase58(), {
        filters: [
            {
                memcmp: {
                    offset: 472, // lpMint offset in AmmInfo struct
                    bytes: TEST_LP_MINT,
                },
            },
        ],
        dataSlice: {
            offset: 0,
            length: 600, // Get enough to see the nonce
        },
    });

    console.log('Found pools:', pools.length);
    for (const pool of pools) {
        console.log('Pool:', pool.pubkey);
        const data = Buffer.from(pool.account.data, 'base64');
        console.log('Data length:', data.length);

        // In Raydium V4 AmmInfo, the nonce is at a specific offset
        // Let's dump some key offsets
        // status: u64 at 0
        // nonce: u64 at 8
        const status = data.readBigUInt64LE(0);
        const nonce = data.readBigUInt64LE(8);
        console.log('Status:', status);
        console.log('Nonce:', nonce);

        // Try deriving with this nonce
        try {
            const poolPda = PublicKey.createProgramAddressSync(
                [AUTHORITY_SEED, Buffer.from([Number(nonce)])],
                RAYDIUM_AMM_PROGRAM_ID,
            );
            console.log('PDA with pool nonce:', poolPda.toBase58());
            console.log('Match:', poolPda.toBase58() === mintAuthority);
        } catch (_e) {
            console.log('PDA with pool nonce: invalid');
        }
    }
}

main().catch(console.error);
