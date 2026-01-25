import { base58Encode } from '../lib/solana-rpc';

const poolData = Buffer.from("8ZptBBGxbbz+AAB3d8VjGx4TBL/VCXYeKZ9tPIxUae5l4K9884xG8TgoPQabiFf+q4GE+2h/Y0YYwDXaxDncGus7VZig8AAAAAABiHF/HQ+HceU0bTec0dnZ+K8duiMKKc62Y9Pkhbc4J9YAlskzfrbM8b09NTTiCWZcqSA6GsKYtUBw3qnLpdXykRjlKUxtgZOy9jbuA5VSnUwI4P5bkwddQa3FDPXuAfYP23IonpJACRUNfI4nsWVR9p8pWstkT/Ei50iqvzoOqhFkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==", "base64");

console.log("Pool data length:", poolData.length, "bytes");

// Try to find all 32-byte pubkeys in the data
console.log("\nAll potential pubkeys in pool data:");
for (let i = 0; i <= poolData.length - 32; i += 32) {
    const pubkey = base58Encode(new Uint8Array(poolData.slice(i, i + 32)));
    console.log(`  Offset ${i.toString().padStart(3)}: ${pubkey}`);
}

// Known values to match:
// LP mint we're querying: 13JMe5u3Pc1X9t2kY11wB1ipFgipSkr7FjmB5YyPyF8c
// WSOL: So11111111111111111111111111111111111111112
// Pool authority/mint authority: 7xhEw5ofdg9mSM1yTRss6u6poxLEnqLGL5hhdnpG7zqT
