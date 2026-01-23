# CLI Reference

This document provides detailed information about the command-line interface (CLI) for the Token API Scraper.

## Overview

The CLI provides a unified interface for managing database setup, running services, and configuring the scraper. All commands are accessed through:

```bash
npm run cli <command> [options]
```

## Commands

### help

Display help information about available commands.

```bash
npm run cli help
```

### version

Show the current version of the application.

```bash
npm run cli version
```

### list

List all available services that can be run.

```bash
npm run cli list
```

Output example:

```
Available services:
  - metadata
  - polymarket
```

### setup

Deploy SQL schema files and materialized views to your ClickHouse database. This is required before running any services.

The setup command has several subcommands for deploying different schemas:

#### Named Setup Actions

These are the recommended setup commands for deploying specific schemas:

```bash
# Deploy metadata tables (metadata, metadata_errors)
npm run cli setup metadata

# Deploy polymarket tables (polymarket_markets, polymarket_assets)
npm run cli setup polymarket

# Deploy forked-blocks table and refreshable materialized view
# NOTE: This is a refreshable MV and only needs to be run once to initialize
npm run cli setup forked-blocks \
  --canonical-database mainnet:blocks@v0.1.0 \
  --clickhouse-database mainnet:evm-transfers@v0.2.1
```

#### Forked Blocks Setup (Refreshable MV)

The `forked-blocks` setup deploys a refreshable materialized view that automatically detects forked blocks by comparing source blocks against canonical blocks. It only needs to be run once to initialize the tables and MV.

The source database (blocks to check for forks) is taken from `--clickhouse-database` or the `CLICKHOUSE_DATABASE` environment variable, consistent with other setup commands.

```bash
# Basic setup
npm run cli setup forked-blocks \
  --canonical-database mainnet:blocks@v0.1.0 \
  --clickhouse-database mainnet:evm-transfers@v0.2.1

# Using environment variable for source database
CLICKHOUSE_DATABASE=mainnet:evm-transfers@v0.2.1 npm run cli setup forked-blocks \
  --canonical-database mainnet:blocks@v0.1.0

# With custom refresh interval (every 5 minutes)
npm run cli setup forked-blocks \
  --canonical-database mainnet:blocks@v0.1.0 \
  --clickhouse-database mainnet:evm-transfers@v0.2.1 \
  --refresh-interval 300

# With custom lookback period (7 days)
npm run cli setup forked-blocks \
  --canonical-database mainnet:blocks@v0.1.0 \
  --clickhouse-database mainnet:evm-transfers@v0.2.1 \
  --days-back 7
```

**Forked Blocks Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--canonical-database <db>` | Database containing canonical/irreversible blocks (required) | `CLICKHOUSE_BLOCKS_DATABASE` env var |
| `--clickhouse-database <db>` | Database containing source blocks to check (required) | `CLICKHOUSE_DATABASE` env var |
| `--days-back <days>` | Number of days to look back for forked blocks | `30` |
| `--refresh-interval <seconds>` | Refresh interval in seconds for the MV | `60` |

#### Custom Files Setup

For deploying custom SQL files, use the `files` subcommand:

```bash
# Deploy custom SQL files
npm run cli setup files sql.schemas/custom.sql

# Deploy multiple files
npm run cli setup files sql.schemas/schema.metadata_evm.sql

# Use wildcards
npm run cli setup files sql.schemas/schema.*.sql
```

#### Cluster Support

For ClickHouse clusters, use the `--cluster` flag with any setup command. This will:

- Add `ON CLUSTER '<name>'` to all CREATE/ALTER statements
- Convert `MergeTree` engines to `ReplicatedMergeTree`
- Convert `ReplacingMergeTree` to `ReplicatedReplacingMergeTree`

```bash
# Deploy to a cluster
npm run cli setup metadata-evm --cluster my_cluster

# Deploy forked-blocks to cluster
npm run cli setup forked-blocks \
  --canonical-database mainnet:blocks@v0.1.0 \
  --clickhouse-database mainnet:evm-transfers@v0.2.1 \
  --cluster production_cluster

# Deploy files to cluster with custom database
npm run cli setup files sql.schemas/schema.*.sql \
  --cluster production_cluster \
  --clickhouse-url http://clickhouse-node1:8123 \
  --clickhouse-database evm_data
```

#### Schema Files

The project includes these schema files in `sql.schemas/`:

1. **schema.metadata_evm.sql**: EVM token metadata storage
   - `metadata` table - Stores token name, symbol, and decimals
   - `metadata_errors` table - Tracks RPC errors during metadata fetching

2. **schema.metadata_solana.sql**: Solana token metadata storage
   - `metadata` table - Stores token name, symbol, decimals, uri, source, and standard
   - `metadata_errors` table - Tracks RPC errors during metadata fetching

3. **schema.polymarket.sql**: Polymarket tables
   - `polymarket_markets` table - Stores Polymarket market metadata
   - `polymarket_assets` table - Links asset IDs to condition IDs

4. **schema.blocks_forked.sql**: Forked blocks table
   - `blocks_forked` table - Stores detected forked blocks

5. **mv.blocks_forked.sql**: Forked blocks materialized view
   - `mv_blocks_forked` - Refreshable MV that populates blocks_forked

### run

Run a specific service. Each service performs different data collection tasks.

#### Services

##### metadata

Fetches token metadata (name, symbol, decimals) from smart contracts.

```bash
npm run cli run metadata

# With custom concurrency
npm run cli run metadata --concurrency 20

# With Prometheus metrics
npm run cli run metadata --enable-prometheus --prometheus-port 8080
```

##### polymarket

Processes Polymarket market metadata.

```bash
npm run cli run polymarket

# With custom parameters
npm run cli run polymarket --concurrency 15 --enable-prometheus
```

## Command-Line Flags

All flags override environment variables. Available for `setup` and `run` commands:

### Database Options

| Flag | Description | Default |
|------|-------------|---------|
| `--clickhouse-url <url>` | ClickHouse database URL | `http://localhost:8123` |
| `--clickhouse-username <user>` | ClickHouse username | `default` |
| `--clickhouse-password <pass>` | ClickHouse password | (empty) |
| `--clickhouse-database <db>` | ClickHouse database name | `default` |

### RPC Options

| Flag | Description | Default |
|------|-------------|---------|
| `--node-url <url>` | EVM RPC node URL | (required) |

### Performance Options

| Flag | Description | Default |
|------|-------------|---------|
| `--concurrency <num>` | Number of concurrent RPC requests | `10` |
| `--max-retries <num>` | Maximum number of retry attempts | `3` |
| `--base-delay-ms <num>` | Base delay for exponential backoff | `400` |
| `--jitter-min <num>` | Minimum jitter multiplier | `0.7` |
| `--jitter-max <num>` | Maximum jitter multiplier | `1.3` |
| `--max-delay-ms <num>` | Maximum delay between retries | `30000` |
| `--timeout-ms <num>` | Timeout for individual RPC requests | `10000` |

### Monitoring Options

| Flag | Environment Variable | Description | Default |
|------|---------------------|-------------|---------|
| `--prometheus-port <port>` | `PROMETHEUS_PORT` | Prometheus metrics HTTP port (always enabled) | `9090` |
| `--verbose` | `VERBOSE` | Enable verbose logging output | `false` |

**Note**: When `--verbose` is disabled (default), all console logging is suppressed. Prometheus metrics are always enabled and computed.

### Auto-restart Options

Services automatically run in continuous mode, restarting after each completion to keep processing new data.

| Flag | Environment Variable | Description | Default |
|------|---------------------|-------------|---------|
| `--auto-restart-delay <seconds>` | `AUTO_RESTART_DELAY` | Delay in seconds before restarting | `10` |

### Service-Specific Options

| Flag | Description | Default |
|------|-------------|---------|
| `--transfers-table <table>` | Name of the transfers table to query | `transfers` |
| `--cluster <name>` | ClickHouse cluster name (setup only) | (none) |

Valid values for `--transfers-table`: `transfers`, `native_transfer`, `erc20_transfer`

## Usage Examples

### Complete Setup Workflow

```bash
# 1. Setup database schemas
npm run cli setup metadata

# 2. Fetch token metadata
npm run cli run metadata-transfers
npm run cli run metadata-swaps
npm run cli run metadata-balances

# 3. Optionally run polymarket service
npm run cli run polymarket
```

### Custom Configuration

```bash
# Run with verbose logging enabled
npm run cli run metadata --verbose

# Run silently (default - no verbose output)
npm run cli run metadata

# Run with custom database and RPC settings with verbose output
npm run cli run metadata \
  --verbose \
  --clickhouse-url http://clickhouse.example.com:8123 \
  --clickhouse-username scraper \
  --clickhouse-password secret123 \
  --clickhouse-database evm_data \
  --node-url https://your-tron-node.example.com \
  --concurrency 20
```

### Production Deployment

```bash
# Deploy to ClickHouse cluster using named setup commands
npm run cli setup metadata --cluster production_cluster \
  --clickhouse-url http://clickhouse-node1:8123 \
  --clickhouse-database production_evm

npm run cli setup balances --cluster production_cluster \
  --clickhouse-url http://clickhouse-node1:8123 \
  --clickhouse-database production_evm

# Or deploy all files at once
npm run cli setup files sql.schemas/schema.*.sql \
  --cluster production_cluster \
  --clickhouse-url http://clickhouse-node1:8123 \
  --clickhouse-database production_evm

# Run metadata service
npm run cli run metadata-transfers \
  --clickhouse-url http://clickhouse-node1:8123 \
  --clickhouse-database production_evm
```

## Legacy npm Scripts

For backward compatibility, direct npm scripts are still available:

```bash
# Run metadata RPC service
npm run start

# Run tests
npm run test
```

## Logging and Monitoring

### Logging

Services use structured logging via tslog. All services emit logs in JSON or pretty format depending on the `LOG_TYPE` environment variable.

When `--verbose` is enabled, you'll see additional console output including:

- Task overview at the start
- Batch insert status messages

### Prometheus Metrics

Prometheus metrics are always enabled and provide real-time monitoring of service performance:

- `scraper_total_tasks` - Total number of tasks to process
- `scraper_completed_tasks_total` - Total number of completed tasks (labeled by status: success/error)
- `scraper_error_tasks_total` - Total number of failed tasks
- `scraper_requests_per_second` - Current requests per second
- `scraper_progress_percentage` - Current progress percentage

Access metrics at: `http://localhost:9090/metrics` (or your configured Prometheus port)

### Silent Mode (Default)

When `--verbose` is not specified (default behavior), the service runs with minimal console output, relying on structured logs. This is useful for:

- Automated/scheduled tasks
- Running services in the background
- Reducing console verbosity in production

Prometheus metrics continue to be collected and available regardless of verbose setting.

## Exit Codes

The CLI uses standard exit codes:

- `0` - Success
- `1` - General error
- `2` - Invalid command or arguments

## Troubleshooting

### Command Not Found

If you get "command not found" errors:

```bash
# Make sure dependencies are installed
npm install

# Or use with bun
bun install
```

### Permission Errors

If you get permission errors:

```bash
# Ensure the cli.ts file is accessible
chmod +x cli.ts
```

### Database Connection Errors

If you can't connect to ClickHouse:

```bash
# Test connection manually
curl http://localhost:8123/ping

# Verify credentials
npm run cli setup files sql.schemas/schema.metadata_evm.sql \
  --clickhouse-url http://localhost:8123 \
  --clickhouse-username default \
  --clickhouse-password "" \
  --clickhouse-database default
```

### Service Errors

If a service fails to start:

1. Check the error message for specific details
2. Verify database schema is deployed: `npm run cli setup files sql.schemas/schema.*.sql`
3. Check configuration with environment variables or flags
4. Review logs for detailed error information
5. Try reducing concurrency: `--concurrency 5`

## Advanced Usage

### Running Multiple Services

You can run multiple services in parallel for maximum throughput:

```bash
# Terminal 1: Metadata from transfers
npm run cli run metadata-transfers

# Terminal 2: Metadata from swaps
npm run cli run metadata-swaps

# Terminal 3: Metadata from balances
npm run cli run metadata-balances

# Terminal 4: Polymarket service
npm run cli run polymarket
```

### Automated Scheduling

Set up cron jobs for periodic updates:

```bash
# crontab -e
# Run every hour
0 * * * * cd /path/to/token-api-scraper && npm run cli run metadata-transfers
```

### Continuous Operation

Services automatically run in continuous mode, restarting after each completion to keep processing new data. The service runs in the same process without exiting, preserving Prometheus metrics across runs.

```bash
# Run with default 10 second delay between restarts
npm run cli run metadata-transfers

# Custom delay (30 seconds) between restarts
npm run cli run metadata-swaps --auto-restart-delay 30

# Combine with other options
npm run cli run metadata-transfers \
  --auto-restart-delay 60 \
  --concurrency 20
```

**Benefits of continuous operation:**

- Process stays alive, avoiding overhead of process restarts
- Prometheus metrics are preserved and accumulated across runs
- Better for long-running monitoring scenarios
- Simplified deployment (no need for external process managers)

**Note:** The service only restarts after successful completion (exit code 0). Failures will not trigger a restart.

### Docker Integration

See [DOCKER.md](./DOCKER.md) for Docker-specific CLI usage.
