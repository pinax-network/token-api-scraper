#!/usr/bin/env bun
import { Command } from 'commander';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Read version from package.json
const VERSION = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version;

/**
 * Available services that can be run via the CLI
 * Each service corresponds to a TypeScript file in the services directory
 */
const SERVICES = {
    'metadata': {
        path: './services/metadata_rpc.ts',
        description: 'Fetch and store ERC-20/TRC-20 token metadata (name, symbol, decimals) from smart contracts'
    },
    'trc20-balances': {
        path: './services/trc20_balances_rpc.ts',
        description: 'Query and update TRC-20 token balances for accounts using the balanceOf() function'
    },
    'native-balances': {
        path: './services/native_balances_rpc.ts',
        description: 'Query and update native TRX balances for accounts on the Tron network'
    }
};

// Initialize Commander program
const program = new Command();

program
    .name('substreams-tron-scraper')
    .description('CLI tool for running Tron blockchain data scraping services')
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
            'TRON RPC node URL for querying blockchain data. Can be a public node or your own.',
            process.env.NODE_URL || 'https://tron-evm-rpc.publicnode.com'
        )
        .option(
            '--concurrency <number>',
            'Number of concurrent RPC requests. Higher values = faster but may hit rate limits. Range: 1-50.',
            process.env.CONCURRENCY || '10'
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
        ENABLE_PROMETHEUS: options.enablePrometheus ? 'true' : (process.env.ENABLE_PROMETHEUS || 'false'),
        PROMETHEUS_PORT: options.prometheusPort
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

Examples:
  $ npm run cli run metadata
  $ npm run cli run trc20-balances --concurrency 20
  $ npm run cli run native-balances --enable-prometheus --prometheus-port 8080
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
// Parse CLI arguments
// ============================================================================
program.parse(process.argv);
