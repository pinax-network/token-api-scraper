#!/usr/bin/env bun
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ProgressTracker } from './lib/progress';
import { executeSqlSetup, promptClusterSelection } from './lib/setup';

// Read version from package.json
const VERSION = JSON.parse(
    readFileSync(resolve(__dirname, 'package.json'), 'utf8'),
).version;

// Default auto-restart delay in seconds
const DEFAULT_AUTO_RESTART_DELAY = 10;

/**
 * Available services that can be run via the CLI
 * Each service corresponds to a TypeScript file in the services directory
 */
const SERVICES = {
    'metadata-transfers': {
        path: './services/metadata/transfers.ts',
        description:
            'Fetch and store ERC-20 token metadata (name, symbol, decimals) from `transfers`',
    },
    'metadata-swaps': {
        path: './services/metadata/swaps.ts',
        description:
            'Fetch and store ERC-20 token metadata (name, symbol, decimals) from `swaps`',
    },
    'balances-erc20': {
        path: './services/balances/erc20.ts',
        description:
            'Query and update ERC-20 token balances for accounts using the balanceOf() function',
    },
    'balances-native': {
        path: './services/balances/native.ts',
        description:
            'Query and update native token balances for accounts on the TRON network',
    },
};

// Initialize Commander program
const program = new Command();

program
    .name('token-api-scraper')
    .description(
        'CLI tool for running ERC-20 blockchain data scraping services',
    )
    .version(VERSION, '-v, --version', 'Display the current version');

/**
 * Helper function to create common options for service commands
 * These options control database connection, RPC settings, and monitoring
 */
function addCommonOptions(command: Command): Command {
    return (
        command
            // ClickHouse Database Options
            .option(
                '--clickhouse-url <url>',
                'ClickHouse database connection URL. Used for storing scraped blockchain data.',
                process.env.CLICKHOUSE_URL || 'http://localhost:8123',
            )
            .option(
                '--clickhouse-username <user>',
                'Username for authenticating with the ClickHouse database.',
                process.env.CLICKHOUSE_USERNAME || 'default',
            )
            .option(
                '--clickhouse-password <password>',
                'Password for authenticating with the ClickHouse database. Keep this secure!',
                process.env.CLICKHOUSE_PASSWORD || '',
            )
            .option(
                '--clickhouse-database <db>',
                'Name of the ClickHouse database to use for data storage.',
                process.env.CLICKHOUSE_DATABASE || 'default',
            )
            // RPC Node Options
            .option(
                '--node-url <url>',
                'EVM RPC node URL for querying blockchain data. Can be a public node or your own.',
                process.env.NODE_URL || 'https://tron-evm-rpc.publicnode.com',
            )
            .option(
                '--concurrency <number>',
                'Number of concurrent RPC requests. Higher values = faster but may hit rate limits. Range: 1-50.',
                process.env.CONCURRENCY || '40',
            )
            // Retry Configuration Options
            .option(
                '--max-retries <number>',
                'Maximum number of retry attempts for failed RPC requests.',
                process.env.MAX_RETRIES || '3',
            )
            .option(
                '--base-delay-ms <number>',
                'Base delay in milliseconds for exponential backoff between retries.',
                process.env.BASE_DELAY_MS || '400',
            )
            .option(
                '--jitter-min <number>',
                'Minimum jitter multiplier for backoff delay (e.g., 0.7 = 70% of backoff).',
                process.env.JITTER_MIN || '0.7',
            )
            .option(
                '--jitter-max <number>',
                'Maximum jitter multiplier for backoff delay (e.g., 1.3 = 130% of backoff).',
                process.env.JITTER_MAX || '1.3',
            )
            .option(
                '--max-delay-ms <number>',
                'Maximum delay in milliseconds between retry attempts (cap on backoff).',
                process.env.MAX_DELAY_MS || '30000',
            )
            .option(
                '--timeout-ms <number>',
                'Timeout in milliseconds for individual RPC requests.',
                process.env.TIMEOUT_MS || '10000',
            )
            // Monitoring Options
            .option(
                '--prometheus-port <port>',
                'HTTP port for the Prometheus metrics endpoint. Accessible at http://localhost:<port>/metrics',
                process.env.PROMETHEUS_PORT || '9090',
            )
            // Logging Options
            .option(
                '--verbose',
                'Enable verbose logging output. When disabled, only errors are shown. Prometheus metrics are still computed.',
                process.env.VERBOSE === 'true',
            )
            .option(
                '--auto-restart-delay <seconds>',
                `Delay in seconds before restarting the service (default: ${DEFAULT_AUTO_RESTART_DELAY}).`,
                process.env.AUTO_RESTART_DELAY ||
                    String(DEFAULT_AUTO_RESTART_DELAY),
            )
    );
}

/**
 * Runs a service directly in the current process with continuous auto-restart
 * @param serviceName - Name of the service to run (must exist in SERVICES)
 * @param options - Commander options object containing CLI flags
 */
async function runService(serviceName: string, options: any) {
    const service = SERVICES[serviceName as keyof typeof SERVICES];

    if (!service) {
        console.error(`❌ Error: Unknown service '${serviceName}'`);
        console.log(
            `\n📋 Available services: ${Object.keys(SERVICES).join(', ')}`,
        );
        process.exit(1);
    }

    const autoRestartDelay = parseInt(
        options.autoRestartDelay || String(DEFAULT_AUTO_RESTART_DELAY),
        10,
    );

    // Validate autoRestartDelay
    if (Number.isNaN(autoRestartDelay) || autoRestartDelay < 1) {
        console.error(
            `❌ Error: Invalid auto-restart delay '${options.autoRestartDelay}'. Must be a positive number (minimum 1 second).`,
        );
        process.exit(1);
    }

    if (options.verbose) {
        console.log(`🚀 Starting service: ${serviceName}\n`);
        console.log(
            `🔄 Auto-restart enabled with ${autoRestartDelay}s delay\n`,
        );
    }

    const servicePath = resolve(__dirname, service.path);

    // Build environment variables from CLI options
    // CLI options override existing environment variables
    process.env.CLICKHOUSE_URL = options.clickhouseUrl;
    process.env.CLICKHOUSE_USERNAME = options.clickhouseUsername;
    process.env.CLICKHOUSE_PASSWORD = options.clickhousePassword;
    process.env.CLICKHOUSE_DATABASE = options.clickhouseDatabase;
    process.env.NODE_URL = options.nodeUrl;
    process.env.CONCURRENCY = options.concurrency;
    process.env.MAX_RETRIES = options.maxRetries;
    process.env.BASE_DELAY_MS = options.baseDelayMs;
    process.env.JITTER_MIN = options.jitterMin;
    process.env.JITTER_MAX = options.jitterMax;
    process.env.MAX_DELAY_MS = options.maxDelayMs;
    process.env.TIMEOUT_MS = options.timeoutMs;
    process.env.PROMETHEUS_PORT = options.prometheusPort;
    process.env.VERBOSE = options.verbose ? 'true' : 'false';

    // Import and run the service module directly
    const serviceModule = await import(servicePath);

    // Check if the service module exports a run function
    if (typeof serviceModule.run !== 'function') {
        console.error(
            `❌ Error: Service '${serviceName}' does not export a run function`,
        );
        process.exit(1);
    }

    // Run the service in a continuous loop
    let tracker: ProgressTracker | undefined;
    let iteration = 0;

    while (true) {
        iteration++;
        try {
            if (options.verbose && iteration > 1) {
                console.log(`\n🔄 Starting iteration ${iteration}...\n`);
            }

            // Run the service, always keeping Prometheus alive for auto-restart
            tracker = await serviceModule.run(tracker);

            if (options.verbose) {
                console.log(
                    `\n✅ Service '${serviceName}' iteration ${iteration} completed successfully`,
                );
            }

            // Wait before restarting
            if (options.verbose) {
                console.log(`⏳ Restarting in ${autoRestartDelay} seconds...`);
            }
            await new Promise((resolve) =>
                setTimeout(resolve, autoRestartDelay * 1000),
            );
        } catch (error) {
            console.error(`❌ Service error:`, error);
            // Close Prometheus server on error
            if (tracker && typeof tracker.stop === 'function') {
                await tracker.stop();
            }
            process.exit(1);
        }
    }
}

// ============================================================================
// COMMAND: run <service>
// ============================================================================
const runCommand = program
    .command('run <service>')
    .description('Run a specific scraper service')
    .addHelpText(
        'after',
        `

Services:
  metadata-transfers          ${SERVICES['metadata-transfers'].description}
  metadata-swaps              ${SERVICES['metadata-swaps'].description}
  balances-erc20    ${SERVICES['balances-erc20'].description}
  balances-native   ${SERVICES['balances-native'].description}

Examples:
  $ npm run cli run metadata-transfers
  $ npm run cli run metadata-swaps
  $ npm run cli run balances-erc20 --concurrency 20
  $ npm run cli run balances-native --prometheus-port 8080
  
  # Auto-restart delay examples
  $ npm run cli run metadata-transfers --auto-restart-delay 30
  $ npm run cli run metadata-swaps --auto-restart-delay 60
    `,
    )
    .action(async (service: string, options: any) => {
        await runService(service, options);
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
        '--cluster [name]',
        'ClickHouse cluster name. If provided without a name, shows available clusters to choose from.',
    )
    .addHelpText(
        'after',
        `

Setup SQL Schema Files:
  The setup command deploys SQL schema files to your ClickHouse database.
  You can provide one or multiple SQL files to execute in sequence.

Cluster Support:
  Use --cluster flag to deploy schemas on a ClickHouse cluster:
  - Adds 'ON CLUSTER <name>' to CREATE TABLE and ALTER TABLE statements
  - Adds 'ON CLUSTER <name>' to CREATE FUNCTION statements
  - Adds 'ON CLUSTER <name>' to CREATE MATERIALIZED VIEW statements
  - Converts MergeTree engines to ReplicatedMergeTree
  - Converts ReplacingMergeTree to ReplicatedReplacingMergeTree

  If --cluster is provided without a name, the tool will query available
  clusters using "SHOW CLUSTERS" and prompt you to select one.

Examples:
  # Deploy single schema file
  $ npm run cli setup sql.schemas/schema.metadata.sql

  # Deploy multiple schema files
  $ npm run cli setup sql.schemas/schema.metadata.sql sql.schemas/schema.balances.sql

  # Deploy all schema files
  $ npm run cli setup sql.schemas/schema.*.sql

  # Deploy to a cluster
  $ npm run cli setup sql.schemas/schema.metadata.sql --cluster my_cluster

  # Interactively select a cluster
  $ npm run cli setup sql.schemas/schema.metadata.sql --cluster

  # Deploy all schemas with custom database
  $ npm run cli setup sql.schemas/schema.*.sql \\
      --clickhouse-url http://localhost:8123 \\
      --clickhouse-database my_database \\
      --cluster production_cluster
    `,
    )
    .action(async (files: string[], options: any) => {
        console.log('🚀 SQL Setup Command\n');

        // Update ClickHouse client environment from CLI options
        // These options override existing environment variables
        if (options.clickhouseUrl)
            process.env.CLICKHOUSE_URL = options.clickhouseUrl;
        if (options.clickhouseUsername)
            process.env.CLICKHOUSE_USERNAME = options.clickhouseUsername;
        if (options.clickhousePassword)
            process.env.CLICKHOUSE_PASSWORD = options.clickhousePassword;
        if (options.clickhouseDatabase)
            process.env.CLICKHOUSE_DATABASE = options.clickhouseDatabase;

        // Handle cluster option
        let clusterName = options.cluster;

        // If --cluster flag is provided without a value (true), prompt for selection
        if (clusterName === true) {
            try {
                clusterName = await promptClusterSelection();
                console.log(`\n✅ Selected cluster: ${clusterName}\n`);
            } catch (error) {
                const err = error as Error;
                console.error(`\n❌ Failed to select cluster: ${err.message}`);
                process.exit(1);
            }
        }

        // Resolve file paths
        const resolvedFiles = files.map((f) => resolve(process.cwd(), f));

        try {
            await executeSqlSetup(resolvedFiles, {
                cluster: clusterName,
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
        process.env.CLICKHOUSE_URL || 'http://localhost:8123',
    )
    .option(
        '--clickhouse-username <user>',
        'Username for authenticating with ClickHouse',
        process.env.CLICKHOUSE_USERNAME || 'default',
    )
    .option(
        '--clickhouse-password <password>',
        'Password for authenticating with ClickHouse',
        process.env.CLICKHOUSE_PASSWORD || '',
    )
    .option(
        '--clickhouse-database <db>',
        'ClickHouse database name',
        process.env.CLICKHOUSE_DATABASE || 'default',
    );

// ============================================================================
// Parse CLI arguments
// ============================================================================
program.parse(process.argv);
