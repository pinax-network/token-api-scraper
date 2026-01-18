import { run as runMetadata } from './run';

export async function run() {
    await runMetadata('swaps');
}

// Run the service if this is the main module
if (import.meta.main) {
    await run();
}
