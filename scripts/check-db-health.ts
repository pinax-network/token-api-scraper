#!/usr/bin/env node
/**
 * Database Health Check Script
 *
 * This script verifies ClickHouse database connectivity before starting
 * or building the application. It checks:
 * 1. DNS resolution for the database host
 * 2. ClickHouse server ping endpoint
 *
 * Set SKIP_DB_CHECK=1 to skip the health check
 * Set DB_CHECK_WARN_ONLY=1 to show warnings but not fail the build
 *
 * Run with: tsx scripts/check-db-health.ts
 */

import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

// Check if health check should be skipped
if (process.env.SKIP_DB_CHECK === '1') {
    console.log('⚠️  Database health check skipped (SKIP_DB_CHECK=1)');
    process.exit(0);
}

// Load environment variables from .env.local or .env
const envLocalPath = resolve(process.cwd(), '.env.local');
const envPath = resolve(process.cwd(), '.env');

if (existsSync(envLocalPath)) {
    config({ path: envLocalPath });
    console.log('Loaded environment from .env.local');
} else if (existsSync(envPath)) {
    config({ path: envPath });
    console.log('Loaded environment from .env');
} else {
    console.log('No .env file found, using environment variables or defaults');
}

// Import after loading env vars
import { runHealthChecks } from '../lib/db-health.js';

async function main() {
    try {
        const result = await runHealthChecks();

        if (!result.overall) {
            if (process.env.DB_CHECK_WARN_ONLY === '1') {
                console.warn(
                    '\n⚠️  Database health checks failed, but continuing (DB_CHECK_WARN_ONLY=1)',
                );
                console.warn(
                    'Please verify your ClickHouse connection settings.\n',
                );
                process.exit(0);
            } else {
                console.error(
                    '\n❌ Database health checks failed. Please verify your ClickHouse connection settings.',
                );
                console.error('To skip this check, set SKIP_DB_CHECK=1');
                console.error(
                    'To show warnings only, set DB_CHECK_WARN_ONLY=1\n',
                );
                process.exit(1);
            }
        }

        process.exit(0);
    } catch (error) {
        console.error('\nUnexpected error during health check:', error);

        if (process.env.DB_CHECK_WARN_ONLY === '1') {
            console.warn(
                '\n⚠️  Continuing despite errors (DB_CHECK_WARN_ONLY=1)\n',
            );
            process.exit(0);
        }

        process.exit(1);
    }
}

main();
