#!/usr/bin/env bun
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { client } from './lib/clickhouse';
import { DEFAULT_CONFIG } from './lib/config';
import { createLogger } from './lib/logger';
import { startPrometheusServer, stopPrometheusServer } from './lib/prometheus';
import { executeSqlSetup, promptClusterSelection } from './lib/setup';

const log = createLogger('cli');

// Read version from package.json
const VERSION = JSON.parse(
    readFileSync(resolve(__dirname, 'package.json'), 'utf8'),
).version;

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
    'forked-blocks': {
        path: './services/forked/index.ts',
        description:
            'Detect and store forked blocks by comparing source blocks against canonical blocks',
    },
    'polymarket-markets': {
        path: './services/polymarket-markets/index.ts',
        description:
            'Fetch and store Polymarket market metadata from condition_id and token0/token1',
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
                process.env.CLICKHOUSE_URL || DEFAULT_CONFIG.CLICKHOUSE_URL,
            )
            .option(
                '--clickhouse-username <user>',
                'Username for authenticating with the ClickHouse database.',
                process.env.CLICKHOUSE_USERNAME ||
                    DEFAULT_CONFIG.CLICKHOUSE_USERNAME,
            )
            .option(
                '--clickhouse-password <password>',
                'Password for authenticating with the ClickHouse database. Keep this secure!',
                process.env.CLICKHOUSE_PASSWORD ||
                    DEFAULT_CONFIG.CLICKHOUSE_PASSWORD,
            )
            .option(
                '--clickhouse-database <db>',
                'Name of the ClickHouse database to use for data storage.',
                process.env.CLICKHOUSE_DATABASE ||
                    DEFAULT_CONFIG.CLICKHOUSE_DATABASE,
            )
            // RPC Node Options
            .option(
                '--node-url <url>',
                'EVM RPC node URL for querying blockchain data. Can be a public node or your own.',
                process.env.NODE_URL || DEFAULT_CONFIG.NODE_URL,
            )
            .option(
                '--concurrency <number>',
                'Number of concurrent RPC requests. Higher values = faster but may hit rate limits. Range: 1-50.',
                process.env.CONCURRENCY || String(DEFAULT_CONFIG.CONCURRENCY),
            )
            // Retry Configuration Options
            .option(
                '--max-retries <number>',
                'Maximum number of retry attempts for failed RPC requests.',
                process.env.MAX_RETRIES || String(DEFAULT_CONFIG.MAX_RETRIES),
            )
            .option(
                '--base-delay-ms <number>',
                'Base delay in milliseconds for exponential backoff between retries.',
                process.env.BASE_DELAY_MS ||
                    String(DEFAULT_CONFIG.BASE_DELAY_MS),
            )
            .option(
                '--jitter-min <number>',
                'Minimum jitter multiplier for backoff delay (e.g., 0.7 = 70% of backoff).',
                process.env.JITTER_MIN || String(DEFAULT_CONFIG.JITTER_MIN),
            )
            .option(
                '--jitter-max <number>',
                'Maximum jitter multiplier for backoff delay (e.g., 1.3 = 130% of backoff).',
                process.env.JITTER_MAX || String(DEFAULT_CONFIG.JITTER_MAX),
            )
            .option(
                '--max-delay-ms <number>',
                'Maximum delay in milliseconds between retry attempts (cap on backoff).',
                process.env.MAX_DELAY_MS || String(DEFAULT_CONFIG.MAX_DELAY_MS),
            )
            .option(
                '--timeout-ms <number>',
                'Timeout in milliseconds for individual RPC requests.',
                process.env.TIMEOUT_MS || String(DEFAULT_CONFIG.TIMEOUT_MS),
            )
            // Monitoring Options
            .option(
                '--prometheus-port <port>',
                'HTTP port for the Prometheus metrics endpoint. Accessible at http://localhost:<port>/metrics',
                process.env.PROMETHEUS_PORT ||
                    String(DEFAULT_CONFIG.PROMETHEUS_PORT),
            )
            .option(
                '--prometheus-hostname <hostname>',
                'Hostname for the Prometheus server to bind to.',
                process.env.PROMETHEUS_HOSTNAME ||
                    DEFAULT_CONFIG.PROMETHEUS_HOSTNAME,
            )
            // Logging Options
            .option(
                '--verbose',
                'Enable verbose logging output. When disabled, only errors are shown. Prometheus metrics are still computed.',
                process.env.VERBOSE === 'true',
            )
            .option(
                '--auto-restart-delay <seconds>',
                `Delay in seconds before restarting the service (default: ${DEFAULT_CONFIG.AUTO_RESTART_DELAY}).`,
                process.env.AUTO_RESTART_DELAY ||
                    String(DEFAULT_CONFIG.AUTO_RESTART_DELAY),
            )
            .option(
                '--allow-prune-errors <seconds>',
                `Remove metadata_errors older than this many seconds. Set to 0 to disable pruning (default: ${DEFAULT_CONFIG.ALLOW_PRUNE_ERRORS}, which is 1 week).`,
                process.env.ALLOW_PRUNE_ERRORS ||
                    String(DEFAULT_CONFIG.ALLOW_PRUNE_ERRORS),
            )
    );
}

/**
 * Interface for CLI options passed to service commands
 */
interface ServiceOptions {
    clickhouseUrl: string;
    clickhouseUsername: string;
    clickhousePassword: string;
    clickhouseDatabase: string;
    clickhouseBlocksDatabase?: string;
    nodeUrl: string;
    concurrency: string;
    maxRetries: string;
    baseDelayMs: string;
    jitterMin: string;
    jitterMax: string;
    maxDelayMs: string;
    timeoutMs: string;
    prometheusPort: string;
    prometheusHostname: string;
    verbose: boolean;
    autoRestartDelay: string;
    allowPruneErrors: string;
}

/**
 * Runs a service directly in the current process with continuous auto-restart
 * @param serviceName - Name of the service to run (must exist in SERVICES)
 * @param options - Commander options object containing CLI flags
 */
async function runService(serviceName: string, options: ServiceOptions) {
    const service = SERVICES[serviceName as keyof typeof SERVICES];

    if (!service) {
        log.error(`Unknown service: ${serviceName}`, {
            availableServices: Object.keys(SERVICES),
        });
        process.exit(1);
    }

    const autoRestartDelay = parseInt(
        options.autoRestartDelay || String(DEFAULT_CONFIG.AUTO_RESTART_DELAY),
        10,
    );

    // Validate autoRestartDelay
    if (Number.isNaN(autoRestartDelay) || autoRestartDelay < 1) {
        log.error('Invalid auto-restart delay', {
            value: options.autoRestartDelay,
            message: 'Must be a positive number (minimum 1 second)',
        });
        process.exit(1);
    }

    const allowPruneErrors = parseInt(
        options.allowPruneErrors || String(DEFAULT_CONFIG.ALLOW_PRUNE_ERRORS),
        10,
    );

    // Validate allowPruneErrors
    if (Number.isNaN(allowPruneErrors) || allowPruneErrors < 0) {
        log.error('Invalid allow-prune-errors', {
            value: options.allowPruneErrors,
            message: 'Must be a non-negative number (0 to disable)',
        });
        process.exit(1);
    }

    if (options.verbose) {
        log.info('Starting service', {
            service: serviceName,
            autoRestartDelay: `${autoRestartDelay}s`,
            allowPruneErrors:
                allowPruneErrors > 0 ? `${allowPruneErrors}s` : 'disabled',
        });
    }

    const servicePath = resolve(__dirname, service.path);

    // Build environment variables from CLI options
    // CLI options override existing environment variables
    process.env.CLICKHOUSE_URL = options.clickhouseUrl;
    process.env.CLICKHOUSE_USERNAME = options.clickhouseUsername;
    process.env.CLICKHOUSE_PASSWORD = options.clickhousePassword;
    process.env.CLICKHOUSE_DATABASE = options.clickhouseDatabase;
    if (options.clickhouseBlocksDatabase) {
        process.env.CLICKHOUSE_BLOCKS_DATABASE =
            options.clickhouseBlocksDatabase;
    }
    process.env.NODE_URL = options.nodeUrl;
    process.env.CONCURRENCY = options.concurrency;
    process.env.MAX_RETRIES = options.maxRetries;
    process.env.BASE_DELAY_MS = options.baseDelayMs;
    process.env.JITTER_MIN = options.jitterMin;
    process.env.JITTER_MAX = options.jitterMax;
    process.env.MAX_DELAY_MS = options.maxDelayMs;
    process.env.TIMEOUT_MS = options.timeoutMs;
    process.env.PROMETHEUS_PORT = options.prometheusPort;
    process.env.PROMETHEUS_HOSTNAME = options.prometheusHostname;
    process.env.VERBOSE = options.verbose ? 'true' : 'false';
    process.env.ALLOW_PRUNE_ERRORS = String(allowPruneErrors);

    // Start Prometheus server once before the loop
    const prometheusPort = parseInt(options.prometheusPort, 10);
    const prometheusHostname = options.prometheusHostname;
    try {
        await startPrometheusServer(prometheusPort, prometheusHostname);
    } catch (error) {
        log.error('Failed to start Prometheus server', { error });
        process.exit(1);
    }

    // Import and run the service module directly
    const serviceModule = await import(servicePath);

    // Check if the service module exports a run function
    if (typeof serviceModule.run !== 'function') {
        log.error('Service does not export a run function', {
            service: serviceName,
        });
        await stopPrometheusServer();
        process.exit(1);
    }

    /**
     * Prune old errors from metadata_errors table
     * Uses ALTER TABLE DELETE to remove errors older than the specified threshold
     */
    async function pruneOldErrors(): Promise<void> {
        if (allowPruneErrors <= 0) {
            return;
        }

        try {
            // allowPruneErrors is safe to interpolate: it's parsed as parseInt() above
            // and validated to be a non-negative integer, so SQL injection is not possible
            const result = await client.command({
                query: `
                    ALTER TABLE metadata_errors
                    DELETE WHERE created_at < now() - INTERVAL ${allowPruneErrors} SECOND
                `,
            });

            if (options.verbose) {
                log.info('Pruned old metadata errors', {
                    thresholdSeconds: allowPruneErrors,
                    queryId: result.query_id,
                });
            }
        } catch (error) {
            log.warn('Failed to prune old metadata errors', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // Run the service in a continuous loop
    let iteration = 0;

    while (true) {
        iteration++;
        try {
            if (options.verbose && iteration > 1) {
                log.info(`Starting iteration ${iteration}`);
            }

            // Prune old errors at the start of each iteration
            await pruneOldErrors();

            // Run the service
            await serviceModule.run();

            if (options.verbose) {
                log.info('Service iteration completed', {
                    service: serviceName,
                    iteration,
                });
            }

            // Wait before restarting
            if (options.verbose) {
                log.info(`Restarting in ${autoRestartDelay} seconds`);
            }
            await new Promise((resolve) =>
                setTimeout(resolve, autoRestartDelay * 1000),
            );
        } catch (error) {
            log.error('Service error', { error });
            // Close Prometheus server on error
            await stopPrometheusServer();
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
  forked-blocks     ${SERVICES['forked-blocks'].description}
  polymarket-markets ${SERVICES['polymarket-markets'].description}

Examples:
  $ npm run cli run metadata-transfers
  $ npm run cli run metadata-swaps
  $ npm run cli run balances-erc20 --concurrency 20
  $ npm run cli run balances-native --prometheus-port 8080
  $ npm run cli run polymarket-markets

  # Forked blocks service
  $ npm run cli run forked-blocks --clickhouse-blocks-database mainnet:blocks@v0.1.0 --clickhouse-database mainnet:evm-transfers@v0.2.1

  # Auto-restart delay examples
  $ npm run cli run metadata-transfers --auto-restart-delay 30
  $ npm run cli run metadata-swaps --auto-restart-delay 60

  # Prune old errors examples (delete errors older than 1 week)
  $ npm run cli run metadata-transfers --allow-prune-errors 604800
  $ npm run cli run metadata-swaps --allow-prune-errors 604800

  # Disable pruning (default is 1 week)
  $ npm run cli run metadata-transfers --allow-prune-errors 0
    `,
    )
    .action(async (service: string, options: any) => {
        await runService(service, options);
    });

// Add common options to the run command
addCommonOptions(runCommand);

// Add forked-blocks specific options
runCommand.option(
    '--clickhouse-blocks-database <db>',
    'Name of the ClickHouse database containing canonical/irreversible blocks (for forked-blocks service).',
    process.env.CLICKHOUSE_BLOCKS_DATABASE,
);

// ============================================================================
// COMMAND: list
// ============================================================================
program
    .command('list')
    .description('List all available services')
    .action(() => {
        log.info('Available services:', {
            services: Object.entries(SERVICES).map(([name, info]) => ({
                name,
                description: info.description,
            })),
        });
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
        log.info('SQL Setup Command');

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
                log.info('Cluster selected', { cluster: clusterName });
            } catch (error) {
                const err = error as Error;
                log.error('Failed to select cluster', { error: err.message });
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
            log.error('Setup failed', { error: err.message });
            process.exit(1);
        }
    });

// Add ClickHouse connection options to setup command
setupCommand
    .option(
        '--clickhouse-url <url>',
        'ClickHouse database connection URL',
        process.env.CLICKHOUSE_URL || DEFAULT_CONFIG.CLICKHOUSE_URL,
    )
    .option(
        '--clickhouse-username <user>',
        'Username for authenticating with ClickHouse',
        process.env.CLICKHOUSE_USERNAME || DEFAULT_CONFIG.CLICKHOUSE_USERNAME,
    )
    .option(
        '--clickhouse-password <password>',
        'Password for authenticating with ClickHouse',
        process.env.CLICKHOUSE_PASSWORD || DEFAULT_CONFIG.CLICKHOUSE_PASSWORD,
    )
    .option(
        '--clickhouse-database <db>',
        'ClickHouse database name',
        process.env.CLICKHOUSE_DATABASE || DEFAULT_CONFIG.CLICKHOUSE_DATABASE,
    );

// ============================================================================
// Parse CLI arguments
// ============================================================================
program.parse(process.argv);
