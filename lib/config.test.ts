import { CONCURRENCY, ENABLE_PROMETHEUS, PROMETHEUS_PORT } from './config';

/**
 * Test to verify the config module parses environment variables correctly
 */
async function testConfig() {
    console.log('Testing config module...\n');

    // Test that CONCURRENCY is a number
    console.log(`  CONCURRENCY: ${CONCURRENCY} (type: ${typeof CONCURRENCY})`);
    if (typeof CONCURRENCY !== 'number' || isNaN(CONCURRENCY)) {
        throw new Error('CONCURRENCY should be a valid number');
    }
    if (CONCURRENCY < 1) {
        throw new Error('CONCURRENCY should be at least 1');
    }

    // Test that ENABLE_PROMETHEUS is a boolean
    console.log(`  ENABLE_PROMETHEUS: ${ENABLE_PROMETHEUS} (type: ${typeof ENABLE_PROMETHEUS})`);
    if (typeof ENABLE_PROMETHEUS !== 'boolean') {
        throw new Error('ENABLE_PROMETHEUS should be a boolean');
    }

    // Test that PROMETHEUS_PORT is a number
    console.log(`  PROMETHEUS_PORT: ${PROMETHEUS_PORT} (type: ${typeof PROMETHEUS_PORT})`);
    if (typeof PROMETHEUS_PORT !== 'number' || isNaN(PROMETHEUS_PORT)) {
        throw new Error('PROMETHEUS_PORT should be a valid number');
    }
    if (PROMETHEUS_PORT < 1 || PROMETHEUS_PORT > 65535) {
        throw new Error('PROMETHEUS_PORT should be a valid port number (1-65535)');
    }

    console.log('\n✅ Config module test completed successfully!');
}

// Run the test if this file is executed directly
if (import.meta.main) {
    testConfig();
}
