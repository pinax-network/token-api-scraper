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
  - trc20-balances
  - native-balances
  - trc20-backfill
  - native-backfill
```

### setup

Deploy SQL schema files to your ClickHouse database. This is required before running any services.

#### Basic Usage

```bash
# Deploy all schema files
npm run cli setup sql/schema.metadata.sql sql/schema.trc20_balances.sql

# Deploy individual files
npm run cli setup sql/schema.metadata.sql

# Use wildcards to deploy multiple files
npm run cli setup sql/schema.*.sql
```

#### Cluster Support

For ClickHouse clusters, use the `--cluster` flag. This will:
- Add `ON CLUSTER '<name>'` to all CREATE/ALTER statements
- Convert `MergeTree` engines to `ReplicatedMergeTree`
- Convert `ReplacingMergeTree` to `ReplicatedReplacingMergeTree`

```bash
# Deploy to a cluster
npm run cli setup sql/schema.*.sql --cluster my_cluster

# Deploy to cluster with custom database
npm run cli setup sql/schema.*.sql \
  --cluster production_cluster \
  --clickhouse-url http://clickhouse-node1:8123 \
  --clickhouse-database evm_data
```

#### Schema Files

The project includes two schema files:

1. **schema.metadata.sql**: Token metadata storage
   - Helper functions: `hex_to_string()`, `hex_to_uint256()`
   - `metadata_rpc` table - Stores token name, symbol, and decimals from smart contracts
   - Uses ReplacingMergeTree for automatic deduplication

2. **schema.trc20_balances.sql**: Balance tables
   - Helper functions: `hex_to_uint256()`, `format_balance()`
   - `trc20_balances_rpc` - TRC-20 token balances with block number tracking
   - `native_balances_rpc` - Native token balances

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

##### trc20-balances

Processes TRC-20 token balances incrementally (only new transfers since last run).

```bash
npm run cli run trc20-balances

# With custom parameters
npm run cli run trc20-balances --concurrency 15 --enable-prometheus
```

##### native-balances

Processes native token balances incrementally (only new accounts without balances).

```bash
npm run cli run native-balances

# With custom transfers table
npm run cli run native-balances --transfers-table native_transfer
```

##### trc20-backfill

Processes all historical TRC-20 transfers from newest to oldest blocks. Run repeatedly until complete.

```bash
npm run cli run trc20-backfill

# With higher concurrency for faster processing
npm run cli run trc20-backfill --concurrency 20
```

##### native-backfill

Processes all historical accounts from newest to oldest blocks. Run repeatedly until complete.

```bash
npm run cli run native-backfill

# With monitoring
npm run cli run native-backfill --enable-prometheus --prometheus-port 9091
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
| `--node-url <url>` | EVM RPC node URL | `https://tron-evm-rpc.publicnode.com` |

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

Valid values for `--transfers-table`: `transfers`, `native_transfer`, `trc20_transfer`

## Usage Examples

### Complete Setup Workflow

```bash
# 1. Setup database schema
npm run cli setup sql/schema.metadata.sql sql/schema.trc20_balances.sql

# 2. Fetch token metadata
npm run cli run metadata

# 3. Start scraping TRC-20 balances (incremental)
npm run cli run trc20-balances

# 4. Optionally backfill historical data in parallel
npm run cli run trc20-backfill --concurrency 15
npm run cli run native-backfill --concurrency 15
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

# Run backfill with monitoring and verbose logs
npm run cli run trc20-backfill \
  --verbose \
  --concurrency 15 \
  --enable-prometheus \
  --prometheus-port 8080 \
  --max-retries 5
```

### Production Deployment

```bash
# Deploy to ClickHouse cluster
npm run cli setup sql/schema.*.sql \
  --cluster production_cluster \
  --clickhouse-url http://clickhouse-node1:8123 \
  --clickhouse-database production_evm

# Run with production settings
npm run cli run trc20-balances \
  --clickhouse-url http://clickhouse-node1:8123 \
  --clickhouse-database production_evm \
  --concurrency 20 \
  --max-retries 5 \
  --enable-prometheus \
  --prometheus-port 9090
```

### Custom Transfers Table

```bash
# Use a different transfers table name
npm run cli run trc20-balances --transfers-table trc20_transfer
npm run cli run native-balances --transfers-table native_transfer
```

## Legacy npm Scripts

For backward compatibility, direct npm scripts are still available:

```bash
# Run metadata RPC service
npm run start

# Run TRC-20 balances RPC service (incremental updates)
npm run balances

# Run Native balances RPC service (incremental updates)
npm run native-balances

# Run TRC-20 balances BACKFILL service
npm run backfill-erc20

# Run Native balances BACKFILL service
npm run backfill-native

# Run tests
npm run test
```

## Progress Monitoring

All services include comprehensive progress monitoring when `--verbose` is enabled (disabled by default).

### Verbose Mode

When `--verbose` is enabled, you'll see detailed progress information:

### Real-time Progress Bar

Shows:
- Completion percentage
- Estimated time to completion (ETA)
- Current request rate
- Success/error counts

Example output:
```
Progress: [████████████████████] 100% | ETA: 0s | 10000/10000 | Success: 9950 | Errors: 50 | Rate: 15.2/s
```

### Task Overview

At the start, services display:
- Total unique contracts to process
- Total unique accounts to process
- Total tasks to process

Example:
```
📋 Task Overview:
   Unique contracts: 150
   Unique accounts: 5000
   Total tasks to process: 10000
```

### Statistics Summary

At the end, services display:
- Success/error counts and percentages
- Total elapsed time
- Average request rate

Example:
```
✅ Statistics Summary:
   Success: 9950 (99.5%)
   Errors: 50 (0.5%)
   Elapsed: 656s
   Avg Rate: 15.2 req/s
```

### Silent Mode (Default)

When `--verbose` is not specified (default behavior), the service runs silently with no console output except for errors. This is useful for:
- Automated/scheduled tasks
- Running services in the background
- Reducing log verbosity in production

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
npm run cli setup sql/schema.metadata.sql \
  --clickhouse-url http://localhost:8123 \
  --clickhouse-username default \
  --clickhouse-password "" \
  --clickhouse-database default
```

### Service Errors

If a service fails to start:

1. Check the error message for specific details
2. Verify database schema is deployed: `npm run cli setup sql/schema.*.sql`
3. Check configuration with environment variables or flags
4. Review logs for detailed error information
5. Try reducing concurrency: `--concurrency 5`

## Advanced Usage

### Running Multiple Services

You can run multiple services in parallel for maximum throughput:

```bash
# Terminal 1: Incremental updates
npm run cli run trc20-balances

# Terminal 2: Historical backfill
npm run cli run trc20-backfill --concurrency 15

# Terminal 3: Native balances
npm run cli run native-backfill --concurrency 15
```

### Automated Scheduling

Set up cron jobs for periodic updates:

```bash
# crontab -e
# Run every hour
0 * * * * cd /path/to/token-api-scraper && npm run cli run trc20-balances
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
