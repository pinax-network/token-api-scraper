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
} else if (existsSync(envPath)) {
    config({ path: envPath });
}

// Import after loading env vars
import { createLogger } from '../lib/logger.js';
import { runHealthChecks } from '../lib/db-health.js';

const log = createLogger('check-db-health');

async function main() {
    try {
        const result = await runHealthChecks();

        if (!result.overall) {
            if (process.env.DB_CHECK_WARN_ONLY === '1') {
                log.warn(
                    'Database health checks failed, but continuing (DB_CHECK_WARN_ONLY=1)',
                );
                process.exit(0);
            } else {
                log.error(
                    'Database health checks failed. Please verify your ClickHouse connection settings.',
                );
                log.info('To skip this check, set SKIP_DB_CHECK=1');
                log.info('To show warnings only, set DB_CHECK_WARN_ONLY=1');
                process.exit(1);
            }
        }

        process.exit(0);
    } catch (error) {
        log.error('Unexpected error during health check', { error });

        if (process.env.DB_CHECK_WARN_ONLY === '1') {
            log.warn('Continuing despite errors (DB_CHECK_WARN_ONLY=1)');
            process.exit(0);
        }

        process.exit(1);
    }
}

main();
