import {
    base58Decode,
    base58Encode,
    derivePumpAmmLpMetadata,
    getAccountInfo,
    isPumpAmmLpToken,
    parsePumpAmmPool,
} from '../lib/solana-rpc';

const _PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

// Test data
const LP_MINT = '13JMe5u3Pc1X9t2kY11wB1ipFgipSkr7FjmB5YyPyF8c';
const POOL = '7xhEw5ofdg9mSM1yTRss6u6poxLEnqLGL5hhdnpG7zqT';
const EXPECTED_WSOL = 'So11111111111111111111111111111111111111112';
const EXPECTED_VIBECOIN = 'ABcpnHu7gy2d87VNxSSWMbr3nhUcPhcUuHCdAkeLi61j';

async function main() {
    console.log('=== Known Addresses ===');
    console.log('LP Mint:', LP_MINT);
    console.log('Pool:', POOL);
    console.log('Expected WSOL:', EXPECTED_WSOL);
    console.log('Expected VIBECOIN:', EXPECTED_VIBECOIN);

    // Get pool data
    const poolInfo = await getAccountInfo(POOL);
    if (!poolInfo || !poolInfo.data) {
        console.log('Pool not found');
        return;
    }

    const data = Buffer.from(poolInfo.data, 'base64');
    console.log('\n=== Pool Data ===');
    console.log('Data length:', data.length);
    console.log('Owner:', poolInfo.owner);

    // Known pubkeys to find
    const knownKeys = {
        WSOL: Buffer.from(base58Decode(EXPECTED_WSOL)),
        VIBECOIN: Buffer.from(base58Decode(EXPECTED_VIBECOIN)),
        LP_MINT: Buffer.from(base58Decode(LP_MINT)),
    };

    console.log('\n=== Searching for known addresses in pool data ===');
    for (const [name, bytes] of Object.entries(knownKeys)) {
        // Search for the pubkey in data
        for (let offset = 0; offset <= data.length - 32; offset++) {
            let match = true;
            for (let i = 0; i < 32; i++) {
                if (data[offset + i] !== bytes[i]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                console.log(`Found ${name} at offset ${offset}`);
            }
        }
    }

    // Parse pool structure
    console.log('\n=== Pool Structure (8-byte discriminator + fields) ===');
    console.log('Discriminator (8 bytes):', data.slice(0, 8).toString('hex'));

    // Try to decode all pubkeys at 32-byte boundaries after discriminator
    console.log('\n=== Pubkeys at 32-byte aligned offsets ===');
    for (let offset = 8; offset + 32 <= data.length; offset += 32) {
        const pubkeyBytes = data.slice(offset, offset + 32);
        const bs58 = base58Encode(pubkeyBytes);
        let label = '';
        if (bs58 === EXPECTED_WSOL) label = ' <- WSOL (quote_mint?)';
        if (bs58 === EXPECTED_VIBECOIN) label = ' <- VIBECOIN (base_mint?)';
        if (bs58 === LP_MINT) label = ' <- LP_MINT';
        if (bs58 === POOL) label = ' <- POOL (self)';
        console.log(`Offset ${offset}: ${bs58}${label}`);
    }

    // Check non-aligned offsets
    console.log('\n=== Non-aligned pubkey scan ===');
    for (let offset = 8; offset + 32 <= data.length; offset++) {
        const pubkeyBytes = data.slice(offset, offset + 32);
        const bs58 = base58Encode(pubkeyBytes);
        if (
            bs58 === EXPECTED_WSOL ||
            bs58 === EXPECTED_VIBECOIN ||
            bs58 === LP_MINT
        ) {
            console.log(`Found at offset ${offset}: ${bs58}`);
        }
    }

    // Test new functions
    console.log('\n=== Testing isPumpAmmLpToken ===');
    const lpCheck = await isPumpAmmLpToken(LP_MINT);
    console.log('Is LP token:', lpCheck.isLpToken);
    console.log('Pool address:', lpCheck.poolAddress);

    if (lpCheck.isLpToken && lpCheck.poolAddress) {
        console.log('\n=== Testing derivePumpAmmLpMetadata ===');
        const lpMetadata = await derivePumpAmmLpMetadata(lpCheck.poolAddress);
        console.log('Derived name:', lpMetadata?.name);
        console.log('Derived symbol:', lpMetadata?.symbol);
    }

    // Test parsePumpAmmPool
    console.log('\n=== Testing parsePumpAmmPool ===');
    const poolData = parsePumpAmmPool(poolInfo.data);
    console.log('Quote mint:', poolData?.quoteMint);
    console.log('Base mint:', poolData?.baseMint);
    console.log('LP mint:', poolData?.lpMint);
}

main().catch(console.error);
