import { base58Encode, getAccountInfo } from '../lib/solana-rpc.ts';

const mint = process.argv[2] || 'J73NU7ttijwcjgoMB7ejeZ47f8ZB48jdc3SkecoLLUTA';

async function checkMint() {
    console.log('Checking mint:', mint);
    const info = await getAccountInfo(mint);
    if (!info?.data) {
        console.log('Account not found');
        return;
    }

    const buffer = Buffer.from(info.data, 'base64');
    const hasAuthority = buffer.readUInt32LE(0) === 1;
    if (!hasAuthority) {
        console.log('No mint authority');
        return;
    }

    const mintAuthority = base58Encode(buffer.slice(4, 36));
    console.log('Mint Authority:', mintAuthority);
    console.log('');
    console.log('Known Raydium authorities:');
    console.log('  AMM V4:  5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1');
    console.log('  CPMM:    GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL');
}

checkMint();
