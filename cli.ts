#!/usr/bin/env bun
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';
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
    polymarket: {
        path: './services/polymarket/index.ts',
        description:
            'Fetch and store Polymarket market metadata from condition_id and token0/token1',
    },
};

/**
 * Available setup actions that can be run via the CLI
 * Each setup action deploys SQL schemas or refreshable materialized views
 */
const SETUP_ACTIONS = {
    metadata: {
        files: ['./sql.schemas/schema.metadata.sql'],
        description: 'Deploy metadata tables (metadata, metadata_errors)',
    },
    balances: {
        files: ['./sql.schemas/schema.balances.sql'],
        description: 'Deploy balances table for ERC-20 token balances',
    },
    polymarket: {
        files: ['./sql.schemas/schema.polymarket.sql'],
        description:
            'Deploy polymarket tables (polymarket_markets, polymarket_assets)',
    },
    'forked-blocks': {
        files: ['./sql.schemas/schema.blocks_forked.sql'],
        description:
            'Deploy blocks_forked table and refreshable materialized view for detecting forked blocks',
        requiresParams: true,
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
                process.env.CLICKHOUSE_DATABASE,
            )
            // RPC Node Options
            .option(
                '--node-url <url>',
                'EVM RPC node URL for querying blockchain data. Can be a public node or your own.',
                process.env.NODE_URL,
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

    if (options.verbose) {
        log.info('Starting service', {
            service: serviceName,
            autoRestartDelay: `${autoRestartDelay}s`,
        });
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
    process.env.PROMETHEUS_HOSTNAME = options.prometheusHostname;
    process.env.VERBOSE = options.verbose ? 'true' : 'false';

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

    // Run the service in a continuous loop
    let iteration = 0;

    while (true) {
        iteration++;
        try {
            if (options.verbose && iteration > 1) {
                log.info(`Starting iteration ${iteration}`);
            }

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
  balances-erc20              ${SERVICES['balances-erc20'].description}
  balances-native             ${SERVICES['balances-native'].description}
  polymarket                  ${SERVICES['polymarket'].description}

Examples:
  $ npm run cli run metadata-transfers
  $ npm run cli run metadata-swaps
  $ npm run cli run balances-erc20 --concurrency 20
  $ npm run cli run balances-native --prometheus-port 8080
  $ npm run cli run polymarket

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
        log.info('Available services:', {
            services: Object.entries(SERVICES).map(([name, info]) => ({
                name,
                description: info.description,
            })),
        });
    });

// ============================================================================
// COMMAND: setup (with subcommands for each table type)
// ============================================================================

/**
 * Helper function to add common ClickHouse options to a command
 */
function addClickhouseOptions(command: Command): Command {
    return command
        .option(
            '--clickhouse-url <url>',
            'ClickHouse database connection URL',
            process.env.CLICKHOUSE_URL || DEFAULT_CONFIG.CLICKHOUSE_URL,
        )
        .option(
            '--clickhouse-username <user>',
            'Username for authenticating with ClickHouse',
            process.env.CLICKHOUSE_USERNAME ||
                DEFAULT_CONFIG.CLICKHOUSE_USERNAME,
        )
        .option(
            '--clickhouse-password <password>',
            'Password for authenticating with ClickHouse',
            process.env.CLICKHOUSE_PASSWORD ||
                DEFAULT_CONFIG.CLICKHOUSE_PASSWORD,
        )
        .option(
            '--clickhouse-database <db>',
            'ClickHouse database name',
            process.env.CLICKHOUSE_DATABASE,
        )
        .option(
            '--cluster [name]',
            'ClickHouse cluster name. If provided without a name, shows available clusters to choose from.',
        );
}

/**
 * Common handler for setup commands
 */
async function handleSetupCommand(
    files: string[],
    options: any,
    queryParams?: Record<string, string | number>,
): Promise<void> {
    // Update ClickHouse client environment from CLI options
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

    try {
        await executeSqlSetup(files, {
            cluster: clusterName,
            queryParams,
        });
        process.exit(0);
    } catch (error) {
        const err = error as Error;
        log.error('Setup failed', { error: err.message });
        process.exit(1);
    }
}

// Create setup command group
const setupCommand = program
    .command('setup')
    .description('Deploy SQL schemas and materialized views to ClickHouse');

// ---- setup metadata ----
const setupMetadata = setupCommand
    .command('metadata')
    .description(SETUP_ACTIONS.metadata.description)
    .addHelpText(
        'after',
        `
This command deploys the metadata tables for storing ERC-20 token metadata.
It only needs to be run once to initialize the tables.

Tables created:
  - metadata: Stores token metadata (name, symbol, decimals)
  - metadata_errors: Tracks RPC errors during metadata fetching

Example:
  $ npm run cli setup metadata
  $ npm run cli setup metadata --cluster my_cluster
`,
    )
    .action(async (options: any) => {
        log.info('Setting up metadata tables');
        const files = SETUP_ACTIONS.metadata.files.map((f) =>
            resolve(__dirname, f),
        );
        await handleSetupCommand(files, options);
    });
addClickhouseOptions(setupMetadata);

// ---- setup balances ----
const setupBalances = setupCommand
    .command('balances')
    .description(SETUP_ACTIONS.balances.description)
    .addHelpText(
        'after',
        `
This command deploys the balances table for storing ERC-20 token balances.
It only needs to be run once to initialize the table.

Tables created:
  - balances: Stores latest token balances per account/contract

Example:
  $ npm run cli setup balances
  $ npm run cli setup balances --cluster my_cluster
`,
    )
    .action(async (options: any) => {
        log.info('Setting up balances table');
        const files = SETUP_ACTIONS.balances.files.map((f) =>
            resolve(__dirname, f),
        );
        await handleSetupCommand(files, options);
    });
addClickhouseOptions(setupBalances);

// ---- setup polymarket ----
const setupPolymarket = setupCommand
    .command('polymarket')
    .description(SETUP_ACTIONS.polymarket.description)
    .addHelpText(
        'after',
        `
This command deploys the Polymarket tables for storing market metadata.
It only needs to be run once to initialize the tables.

Tables created:
  - polymarket_markets: Stores Polymarket market metadata
  - polymarket_assets: Links asset IDs to condition IDs

Example:
  $ npm run cli setup polymarket
  $ npm run cli setup polymarket --cluster my_cluster
`,
    )
    .action(async (options: any) => {
        log.info('Setting up polymarket tables');
        const files = SETUP_ACTIONS.polymarket.files.map((f) =>
            resolve(__dirname, f),
        );
        await handleSetupCommand(files, options);
    });
addClickhouseOptions(setupPolymarket);

// ---- setup forked-blocks ----
const setupForkedBlocks = setupCommand
    .command('forked-blocks')
    .description(SETUP_ACTIONS['forked-blocks'].description)
    .requiredOption(
        '--canonical-database <db>',
        'Database containing canonical/irreversible blocks (e.g., mainnet:blocks@v0.1.0)',
        process.env.CLICKHOUSE_BLOCKS_DATABASE,
    )
    .option(
        '--days-back <days>',
        'Number of days to look back for forked blocks (default: 30, minimum: 1)',
        process.env.FORKED_BLOCKS_DAYS_BACK || '30',
    )
    .option(
        '--refresh-interval <seconds>',
        'Refresh interval in seconds for the materialized view (default: 60, minimum: 15)',
        '60',
    )
    .addHelpText(
        'after',
        `
This command deploys the blocks_forked table and a refreshable materialized view
that periodically detects forked blocks by comparing source blocks against
canonical/irreversible blocks from another database.

NOTE: This is a refreshable MV and only needs to be run once to initialize.
The MV will automatically refresh at the specified interval.

The source database (blocks to check for forks) is taken from --clickhouse-database
or the CLICKHOUSE_DATABASE environment variable, consistent with other setup commands.

Tables/Views created:
  - blocks_forked: Stores detected forked blocks
  - mv_blocks_forked: Refreshable MV that populates blocks_forked

Example:
  $ npm run cli setup forked-blocks \\
      --canonical-database mainnet:blocks@v0.1.0 \\
      --clickhouse-database mainnet:evm-transfers@v0.2.1

  # With custom refresh interval (every 5 minutes)
  $ npm run cli setup forked-blocks \\
      --canonical-database mainnet:blocks@v0.1.0 \\
      --clickhouse-database mainnet:evm-transfers@v0.2.1 \\
      --refresh-interval 300

  # With cluster support
  $ npm run cli setup forked-blocks \\
      --canonical-database mainnet:blocks@v0.1.0 \\
      --clickhouse-database mainnet:evm-transfers@v0.2.1 \\
      --cluster my_cluster

  # Using environment variables
  $ CLICKHOUSE_DATABASE=mainnet:evm-transfers@v0.2.1 npm run cli setup forked-blocks \\
      --canonical-database mainnet:blocks@v0.1.0
`,
    )
    .action(async (options: any) => {
        log.info('Setting up forked-blocks table and refreshable MV');

        const canonicalDatabase = options.canonicalDatabase;
        const sourceDatabase = options.clickhouseDatabase;
        const daysBack = parseInt(options.daysBack || '30', 10);
        const refreshInterval = parseInt(options.refreshInterval || '60', 10);

        // Validate parameters
        if (!canonicalDatabase) {
            log.error('--canonical-database is required');
            process.exit(1);
        }
        if (!sourceDatabase) {
            log.error(
                '--clickhouse-database is required (or set CLICKHOUSE_DATABASE environment variable)',
            );
            process.exit(1);
        }
        if (Number.isNaN(daysBack) || daysBack < 1) {
            log.error('Invalid --days-back', {
                value: options.daysBack,
                message: 'Must be a positive number (minimum 1 day)',
            });
            process.exit(1);
        }
        if (Number.isNaN(refreshInterval) || refreshInterval < 15) {
            log.error('Invalid --refresh-interval', {
                value: options.refreshInterval,
                message:
                    'Must be at least 15 seconds to avoid performance issues',
            });
            process.exit(1);
        }

        log.info('Forked blocks configuration', {
            canonicalDatabase,
            sourceDatabase,
            daysBack,
            refreshInterval,
        });

        const files = SETUP_ACTIONS['forked-blocks'].files.map((f) =>
            resolve(__dirname, f),
        );
        await handleSetupCommand(files, options, {
            canonical_database: canonicalDatabase,
            source_database: sourceDatabase,
            days_back: daysBack,
            refresh_interval: refreshInterval,
        });
    });
addClickhouseOptions(setupForkedBlocks);

// ---- setup files (for backward compatibility) ----
const setupFiles = setupCommand
    .command('files <files...>')
    .description('Deploy SQL schema files to ClickHouse database')
    .addHelpText(
        'after',
        `
Deploy custom SQL schema files to your ClickHouse database.
You can provide one or multiple SQL files to execute in sequence.

Cluster Support:
  Use --cluster flag to deploy schemas on a ClickHouse cluster:
  - Adds 'ON CLUSTER <name>' to CREATE TABLE and ALTER TABLE statements
  - Adds 'ON CLUSTER <name>' to CREATE FUNCTION statements
  - Adds 'ON CLUSTER <name>' to CREATE MATERIALIZED VIEW statements
  - Converts MergeTree engines to ReplicatedMergeTree
  - Converts ReplacingMergeTree to ReplicatedReplacingMergeTree

Examples:
  # Deploy single schema file
  $ npm run cli setup files sql.schemas/schema.metadata.sql

  # Deploy multiple schema files
  $ npm run cli setup files sql.schemas/schema.metadata.sql sql.schemas/schema.balances.sql

  # Deploy all schema files
  $ npm run cli setup files sql.schemas/schema.*.sql

  # Deploy to a cluster
  $ npm run cli setup files sql.schemas/schema.metadata.sql --cluster my_cluster
`,
    )
    .action(async (files: string[], options: any) => {
        log.info('SQL Setup Command');
        const resolvedFiles = files.map((f) => resolve(process.cwd(), f));
        await handleSetupCommand(resolvedFiles, options);
    });
addClickhouseOptions(setupFiles);

// ============================================================================
// Parse CLI arguments
// ============================================================================
program.parse(process.argv);
