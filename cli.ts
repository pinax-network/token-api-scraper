#!/usr/bin/env bun
import { spawn } from 'child_process';
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';
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
            'Query and update TRC-20 token balances for accounts using the balanceOf() function',
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
        'CLI tool for running TRC-20 blockchain data scraping services',
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
                '--enable-prometheus',
                'Enable Prometheus metrics endpoint for monitoring service performance and progress.',
            )
            .option(
                '--prometheus-port <port>',
                'HTTP port for the Prometheus metrics endpoint. Accessible at http://localhost:<port>/metrics',
                process.env.PROMETHEUS_PORT || '9090',
            )
            // Auto-restart Options
            .option(
                '--auto-restart',
                'Automatically restart the service after it completes successfully.',
                process.env.AUTO_RESTART === 'true',
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
 * Spawns a service process with the provided environment variables
 * @param serviceName - Name of the service to run (must exist in SERVICES)
 * @param options - Commander options object containing CLI flags
 */
function runService(serviceName: string, options: any) {
    const service = SERVICES[serviceName as keyof typeof SERVICES];

    if (!service) {
        console.error(`❌ Error: Unknown service '${serviceName}'`);
        console.log(
            `\n📋 Available services: ${Object.keys(SERVICES).join(', ')}`,
        );
        process.exit(1);
    }

    const autoRestart = options.autoRestart || false;
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
        if (autoRestart) {
            console.log(
                `🔄 Auto-restart enabled with ${autoRestartDelay}s delay\n`,
            );
        }
    }

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
        ENABLE_PROMETHEUS: options.enablePrometheus
            ? 'true'
            : process.env.ENABLE_PROMETHEUS || 'true',
        PROMETHEUS_PORT: options.prometheusPort,
        VERBOSE: options.verbose ? 'true' : 'false',
    };

    // Spawn the service as a child process
    const child = spawn('bun', ['run', servicePath], {
        stdio: 'inherit', // Pipe stdout/stderr to parent process
        env,
    });

    child.on('error', (err) => {
        console.error(`❌ Failed to start service: ${err.message}`);
        process.exit(1);
    });

    child.on('exit', (code) => {
        if (code === 0) {
            if (options.verbose) {
                console.log(
                    `\n✅ Service '${serviceName}' completed successfully`,
                );
            }

            // Auto-restart logic
            if (autoRestart) {
                if (options.verbose) {
                    console.log(
                        `⏳ Restarting in ${autoRestartDelay} seconds...`,
                    );
                }
                // Use setTimeout to schedule the restart asynchronously
                // This is safe for long-running scenarios because:
                // 1. Each setTimeout call is async and doesn't add to the call stack
                // 2. The service process completes and exits before the next one starts
                // 3. This is the standard pattern for service restart managers
                setTimeout(() => {
                    if (options.verbose) {
                        console.log(''); // Add blank line for readability
                    }
                    runService(serviceName, options);
                }, autoRestartDelay * 1000);
            } else {
                process.exit(0);
            }
        } else {
            // Exit with the actual error code (null becomes 1)
            process.exit(code ?? 1);
        }
    });
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
  $ npm run cli run balances-native --enable-prometheus --prometheus-port 8080
  
  # Auto-restart examples
  $ npm run cli run metadata-transfers --auto-restart
  $ npm run cli run metadata-swaps --auto-restart --auto-restart-delay 30
    `,
    )
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
