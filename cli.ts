#!/usr/bin/env bun
import { Command } from 'commander';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { executeSqlSetup } from './lib/setup';

// Read version from package.json
const VERSION = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version;

/**
 * Available services that can be run via the CLI
 * Each service corresponds to a TypeScript file in the services directory
 */
const SERVICES = {
    'metadata': {
        path: './services/metadata_rpc.ts',
        description: 'Fetch and store TRC-20 token metadata (name, symbol, decimals) from smart contracts'
    },
    'trc20-balances': {
        path: './services/trc20_balances_rpc.ts',
        description: 'Query and update TRC-20 token balances for accounts using the balanceOf() function'
    },
    'native-balances': {
        path: './services/native_balances_rpc.ts',
        description: 'Query and update native token balances for accounts on the TRON network'
    },
    'trc20-backfill': {
        path: './services/trc20_balances_backfill.ts',
        description: 'Backfill historical TRC-20 token balances from highest to lowest block number'
    },
    'native-backfill': {
        path: './services/native_balances_backfill.ts',
        description: 'Backfill historical native token balances from highest to lowest block number'
    }
};

// Initialize Commander program
const program = new Command();

program
    .name('token-api-scraper')
    .description('CLI tool for running TRC-20 blockchain data scraping services')
    .version(VERSION, '-v, --version', 'Display the current version');

/**
 * Helper function to create common options for service commands
 * These options control database connection, RPC settings, and monitoring
 */
function addCommonOptions(command: Command): Command {
    return command
        // ClickHouse Database Options
        .option(
            '--clickhouse-url <url>',
            'ClickHouse database connection URL. Used for storing scraped blockchain data.',
            process.env.CLICKHOUSE_URL || 'http://localhost:8123'
        )
        .option(
            '--clickhouse-username <user>',
            'Username for authenticating with the ClickHouse database.',
            process.env.CLICKHOUSE_USERNAME || 'default'
        )
        .option(
            '--clickhouse-password <password>',
            'Password for authenticating with the ClickHouse database. Keep this secure!',
            process.env.CLICKHOUSE_PASSWORD || ''
        )
        .option(
            '--clickhouse-database <db>',
            'Name of the ClickHouse database to use for data storage.',
            process.env.CLICKHOUSE_DATABASE || 'default'
        )
        // RPC Node Options
        .option(
            '--node-url <url>',
            'EVM RPC node URL for querying blockchain data. Can be a public node or your own.',
            process.env.NODE_URL || 'https://tron-evm-rpc.publicnode.com'
        )
        .option(
            '--concurrency <number>',
            'Number of concurrent RPC requests. Higher values = faster but may hit rate limits. Range: 1-50.',
            process.env.CONCURRENCY || '10'
        )
        // Retry Configuration Options
        .option(
            '--max-retries <number>',
            'Maximum number of retry attempts for failed RPC requests.',
            process.env.MAX_RETRIES || '3'
        )
        .option(
            '--base-delay-ms <number>',
            'Base delay in milliseconds for exponential backoff between retries.',
            process.env.BASE_DELAY_MS || '400'
        )
        .option(
            '--jitter-min <number>',
            'Minimum jitter multiplier for backoff delay (e.g., 0.7 = 70% of backoff).',
            process.env.JITTER_MIN || '0.7'
        )
        .option(
            '--jitter-max <number>',
            'Maximum jitter multiplier for backoff delay (e.g., 1.3 = 130% of backoff).',
            process.env.JITTER_MAX || '1.3'
        )
        .option(
            '--max-delay-ms <number>',
            'Maximum delay in milliseconds between retry attempts (cap on backoff).',
            process.env.MAX_DELAY_MS || '30000'
        )
        .option(
            '--timeout-ms <number>',
            'Timeout in milliseconds for individual RPC requests.',
            process.env.TIMEOUT_MS || '10000'
        )
        // Monitoring Options
        .option(
            '--enable-prometheus',
            'Enable Prometheus metrics endpoint for monitoring service performance and progress.'
        )
        .option(
            '--prometheus-port <port>',
            'HTTP port for the Prometheus metrics endpoint. Accessible at http://localhost:<port>/metrics',
            process.env.PROMETHEUS_PORT || '9090'
        )
}

/**
 * Spawns a service process with the provided environment variables
 * @param serviceName - Name of the service to run (must exist in SERVICES)
 * @param options - Commander options object containing CLI flags
 */
function runService(serviceName: string, options: any) {
    const service = SERVICES[serviceName as keyof typeof SERVICES];
    
    if (!service) {
        console.error(`❌ Error: Unknown service '${serviceName}'`);
        console.log(`\n📋 Available services: ${Object.keys(SERVICES).join(', ')}`);
        process.exit(1);
    }
    
    console.log(`🚀 Starting service: ${serviceName}\n`);
    
    const servicePath = resolve(__dirname, service.path);
    
    // Build environment variables from CLI options
    // CLI options override existing environment variables
    const env = {
        ...process.env,
        CLICKHOUSE_URL: options.clickhouseUrl,
        CLICKHOUSE_USERNAME: options.clickhouseUsername,
        CLICKHOUSE_PASSWORD: options.clickhousePassword,
        CLICKHOUSE_DATABASE: options.clickhouseDatabase,
        NODE_URL: options.nodeUrl,
        CONCURRENCY: options.concurrency,
        MAX_RETRIES: options.maxRetries,
        BASE_DELAY_MS: options.baseDelayMs,
        JITTER_MIN: options.jitterMin,
        JITTER_MAX: options.jitterMax,
        MAX_DELAY_MS: options.maxDelayMs,
        TIMEOUT_MS: options.timeoutMs,
        ENABLE_PROMETHEUS: options.enablePrometheus ? 'true' : (process.env.ENABLE_PROMETHEUS || 'false'),
        PROMETHEUS_PORT: options.prometheusPort,
        TRANSFERS_TABLE: options.transfersTable
    };
    
    // Spawn the service as a child process
    const child = spawn('bun', ['run', servicePath], {
        stdio: 'inherit',  // Pipe stdout/stderr to parent process
        env
    });
    
    child.on('error', (err) => {
        console.error(`❌ Failed to start service: ${err.message}`);
        process.exit(1);
    });
    
    child.on('exit', (code) => {
        if (code === 0) {
            console.log(`\n✅ Service '${serviceName}' completed successfully`);
        } else {
            console.error(`\n❌ Service '${serviceName}' exited with code ${code}`);
        }
        process.exit(code || 0);
    });
}

// ============================================================================
// COMMAND: run <service>
// ============================================================================
const runCommand = program
    .command('run <service>')
    .description('Run a specific scraper service')
    .addHelpText('after', `

Services:
  metadata          ${SERVICES.metadata.description}
  trc20-balances    ${SERVICES['trc20-balances'].description}
  native-balances   ${SERVICES['native-balances'].description}
  trc20-backfill    ${SERVICES['trc20-backfill'].description}
  native-backfill   ${SERVICES['native-backfill'].description}

Examples:
  $ npm run cli run metadata
  $ npm run cli run trc20-balances --concurrency 20
  $ npm run cli run native-balances --enable-prometheus --prometheus-port 8080
  $ npm run cli run trc20-backfill --concurrency 15
  $ npm run cli run native-backfill --enable-prometheus
  $ npm run cli run metadata --clickhouse-url http://db:8123 --node-url https://api.trongrid.io
    `)
    .action((service: string, options: any) => {
        runService(service, options);
    });

// Add common options to the run command
addCommonOptions(runCommand);

// ============================================================================
// COMMAND: list
// ============================================================================
program
    .command('list')
    .description('List all available services')
    .action(() => {
        console.log('\n📋 Available Services:\n');
        Object.entries(SERVICES).forEach(([name, info]) => {
            console.log(`  ${name.padEnd(20)} ${info.description}`);
        });
        console.log('');
    });

// ============================================================================
// COMMAND: setup <files...>
// ============================================================================
const setupCommand = program
    .command('setup <files...>')
    .description('Deploy SQL schema files to ClickHouse database')
    .option(
        '--cluster <name>',
        'ClickHouse cluster name. Adds ON CLUSTER clause and converts to Replicated* table engines.'
    )
    .addHelpText('after', `

Setup SQL Schema Files:
  The setup command deploys SQL schema files to your ClickHouse database.
  You can provide one or multiple SQL files to execute in sequence.

Cluster Support:
  Use --cluster flag to deploy schemas on a ClickHouse cluster:
  - Adds 'ON CLUSTER <name>' to all CREATE/ALTER statements
  - Converts MergeTree engines to ReplicatedMergeTree
  - Converts ReplacingMergeTree to ReplicatedReplacingMergeTree

Examples:
  # Deploy single schema file
  $ npm run cli setup sql/schema.0.functions.sql

  # Deploy multiple schema files
  $ npm run cli setup sql/schema.0.functions.sql sql/schema.0.offchain.metadata.sql

  # Deploy all schema files
  $ npm run cli setup sql/schema.*.sql

  # Deploy to a cluster
  $ npm run cli setup sql/schema.0.functions.sql --cluster my_cluster

  # Deploy all schemas with custom database
  $ npm run cli setup sql/schema.*.sql \\
      --clickhouse-url http://localhost:8123 \\
      --clickhouse-database my_database \\
      --cluster production_cluster
    `)
    .action(async (files: string[], options: any) => {
        console.log('🚀 SQL Setup Command\n');

        // Update ClickHouse client environment from CLI options
        // These options override existing environment variables
        if (options.clickhouseUrl) process.env.CLICKHOUSE_URL = options.clickhouseUrl;
        if (options.clickhouseUsername) process.env.CLICKHOUSE_USERNAME = options.clickhouseUsername;
        if (options.clickhousePassword) process.env.CLICKHOUSE_PASSWORD = options.clickhousePassword;
        if (options.clickhouseDatabase) process.env.CLICKHOUSE_DATABASE = options.clickhouseDatabase;

        // Resolve file paths
        const resolvedFiles = files.map(f => resolve(process.cwd(), f));

        try {
            await executeSqlSetup(resolvedFiles, {
                cluster: options.cluster
            });
            process.exit(0);
        } catch (error) {
            const err = error as Error;
            console.error(`\n❌ Setup failed: ${err.message}`);
            process.exit(1);
        }
    });

// Add ClickHouse connection options to setup command
setupCommand
    .option(
        '--clickhouse-url <url>',
        'ClickHouse database connection URL',
        process.env.CLICKHOUSE_URL || 'http://localhost:8123'
    )
    .option(
        '--clickhouse-username <user>',
        'Username for authenticating with ClickHouse',
        process.env.CLICKHOUSE_USERNAME || 'default'
    )
    .option(
        '--clickhouse-password <password>',
        'Password for authenticating with ClickHouse',
        process.env.CLICKHOUSE_PASSWORD || ''
    )
    .option(
        '--clickhouse-database <db>',
        'ClickHouse database name',
        process.env.CLICKHOUSE_DATABASE || 'default'
    );

// ============================================================================
// Parse CLI arguments
// ============================================================================
program.parse(process.argv);
