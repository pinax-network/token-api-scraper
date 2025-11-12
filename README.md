# Substreams Tron Scraper

## Features

- **Continuous Query Mechanism**: Tracks block numbers to enable incremental balance updates
- **Efficient Processing**: Only queries new or updated transfers, avoiding redundant RPC calls
- **Progress Monitoring**: Real-time progress tracking with Prometheus metrics support
- **Concurrent Processing**: Configurable concurrency for optimal RPC throughput

## Quickstart

### Using the CLI

```bash
# Show help
npm run cli help

# List available services
npm run cli list

# Show version
npm run cli version

# Run metadata RPC service
npm run cli run metadata

# Run TRC20 balances RPC service (incremental updates)
npm run cli run trc20-balances

# Run Native balances RPC service (incremental updates)
npm run cli run native-balances

# Run TRC20 balances BACKFILL service (process all historical data)
npm run cli run trc20-backfill

# Run Native balances BACKFILL service (process all historical data)
npm run cli run native-backfill

# Run with custom parameters
npm run cli run metadata --concurrency 20 --enable-prometheus
npm run cli run trc20-backfill --concurrency 15 --prometheus-port 8080
```

### Using npm scripts (legacy)

```bash
# Run metadata RPC service
npm run start

# Run TRC20 balances RPC service (incremental updates)
npm run balances

# Run Native balances RPC service (incremental updates)
npm run native-balances

# Run TRC20 balances BACKFILL service (process all historical data)
npm run backfill-trc20

# Run Native balances BACKFILL service (process all historical data)
npm run backfill-native

# Run tests
npm run test
```

## Services Overview

This project includes two types of services:

### Incremental Services
- **TRC20 Balances RPC** (`npm run balances`): Processes only new transfers since last run
- **Native Balances RPC** (`npm run native-balances`): Processes only new accounts without balances

### Backfill Services
- **TRC20 Balances Backfill** (`npm run backfill-trc20`): Processes all historical transfers from newest to oldest blocks
- **Native Balances Backfill** (`npm run backfill-native`): Processes all historical accounts from newest to oldest blocks

**When to use Backfill Services:**
- Initial setup: Fill in all historical balance data from the end of the chain to the beginning
- Gap filling: Process accounts that were missed or failed in previous runs
- Continuous operation: Run repeatedly until all historical data is processed (services will indicate when complete)

**Key Differences:**
- Incremental services skip already-processed data (efficient for ongoing updates)
- Backfill services process ALL data from highest block backward (comprehensive historical fill)
- Both services can run in parallel for maximum throughput

## Configuration

The application can be configured via environment variables. Copy `.env.example` to `.env` and adjust the settings:

```bash
cp .env.example .env
```

### Environment Variables

- `CLICKHOUSE_URL` - ClickHouse database URL (default: `http://localhost:8123`)
- `CLICKHOUSE_USERNAME` - ClickHouse username (default: `default`)
- `CLICKHOUSE_PASSWORD` - ClickHouse password
- `CLICKHOUSE_DATABASE` - ClickHouse database name (default: `default`)
- `NODE_URL` - TRON RPC node URL (default: `https://tron-evm-rpc.publicnode.com`)
- `CONCURRENCY` - Number of concurrent RPC requests (default: `10`)
- `ENABLE_PROMETHEUS` - Enable Prometheus metrics endpoint (default: `false`, set to `true` to enable)
- `PROMETHEUS_PORT` - Prometheus metrics HTTP port (default: `9090`)

### Concurrency Settings

The `CONCURRENCY` environment variable controls how many RPC requests can execute simultaneously in both the metadata and balance scraper services:

- **Default**: 10 concurrent requests
- **Recommended range**: 5-20, depending on RPC node capacity and network conditions
- **Higher values**: Faster processing but may hit rate limits
- **Lower values**: Slower but more conservative on RPC resources

Example:
```bash
# Set concurrency to 5 for conservative processing
CONCURRENCY=5 npm run start
```

## CLI Options

The CLI supports passing configuration via command-line flags, which override environment variables:

```bash
# Available flags:
--clickhouse-url <url>         ClickHouse database URL
--clickhouse-username <user>   ClickHouse username
--clickhouse-password <pass>   ClickHouse password
--clickhouse-database <db>     ClickHouse database name
--node-url <url>               TRON RPC node URL
--concurrency <num>            Number of concurrent RPC requests
--enable-prometheus            Enable Prometheus metrics endpoint
--prometheus-port <port>       Prometheus metrics HTTP port

# Example: Run with custom configuration
npm run cli run metadata \
  --clickhouse-url http://localhost:8123 \
  --concurrency 20 \
  --enable-prometheus \
  --prometheus-port 8080

# Example: Run backfill services with custom settings
npm run cli run trc20-backfill --concurrency 15
npm run cli run native-backfill --enable-prometheus --prometheus-port 9091
```

### Progress Monitoring

The services now include comprehensive progress monitoring with:

- **Real-time Progress Bar**: Shows completion percentage, ETA, request rate, and error count
- **Task Overview**: Displays total unique contracts and accounts to process
- **Statistics Summary**: Final report with success/error counts, elapsed time, and average request rate

### Prometheus Metrics

Enable Prometheus metrics to monitor service performance:

```bash
# Enable Prometheus metrics on default port 9090
ENABLE_PROMETHEUS=true npm run start

# Or specify a custom port
ENABLE_PROMETHEUS=true PROMETHEUS_PORT=8080 npm run start
```

Available metrics:
- `scraper_total_tasks` - Total number of tasks to process
- `scraper_completed_tasks_total` - Total number of completed tasks (labeled by status: success/error)
- `scraper_error_tasks_total` - Total number of failed tasks
- `scraper_requests_per_second` - Current requests per second
- `scraper_progress_percentage` - Current progress percentage

Access metrics at: `http://localhost:9090/metrics` (or your configured port)

## Docker

The project includes a Dockerfile for running the CLI in a containerized environment.

### Building the Docker Image

```bash
docker build -t substreams-tron-scraper .
```

### Running with Docker

```bash
# Show help
docker run substreams-tron-scraper help

# List services
docker run substreams-tron-scraper list

# Show version
docker run substreams-tron-scraper version

# Run a service with environment variables
docker run \
  -e CLICKHOUSE_URL=http://clickhouse:8123 \
  -e CLICKHOUSE_USERNAME=default \
  -e CLICKHOUSE_PASSWORD=password \
  -e NODE_URL=https://tron-evm-rpc.publicnode.com \
  -e CONCURRENCY=10 \
  substreams-tron-scraper run metadata

# Run backfill services
docker run \
  -e CLICKHOUSE_URL=http://clickhouse:8123 \
  -e CONCURRENCY=15 \
  substreams-tron-scraper run trc20-backfill

docker run \
  -e CLICKHOUSE_URL=http://clickhouse:8123 \
  -e CONCURRENCY=15 \
  substreams-tron-scraper run native-backfill

# Run with command-line flags
docker run substreams-tron-scraper run trc20-balances --concurrency 20 --enable-prometheus
```

### Docker Compose Example

```yaml
version: '3.8'
services:
  # Incremental services
  metadata-scraper:
    build: .
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_USERNAME=default
      - CLICKHOUSE_PASSWORD=password
      - CLICKHOUSE_DATABASE=default
      - NODE_URL=https://tron-evm-rpc.publicnode.com
      - CONCURRENCY=10
    command: run metadata

  trc20-balances-scraper:
    build: .
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_USERNAME=default
      - CLICKHOUSE_PASSWORD=password
      - CLICKHOUSE_DATABASE=default
      - NODE_URL=https://tron-evm-rpc.publicnode.com
      - CONCURRENCY=10
    command: run trc20-balances

  # Backfill services
  trc20-backfill-scraper:
    build: .
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_USERNAME=default
      - CLICKHOUSE_PASSWORD=password
      - CLICKHOUSE_DATABASE=default
      - NODE_URL=https://tron-evm-rpc.publicnode.com
      - CONCURRENCY=15
    command: run trc20-backfill

  native-backfill-scraper:
    build: .
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_USERNAME=default
      - CLICKHOUSE_PASSWORD=password
      - CLICKHOUSE_DATABASE=default
      - NODE_URL=https://tron-evm-rpc.publicnode.com
      - CONCURRENCY=15
    command: run native-backfill
```

## Continuous Query Mechanism

The incremental balance services use an intelligent continuous query mechanism that tracks block numbers to enable incremental updates:

- **Block Number Tracking**: Each balance record stores the `block_num` of the transfer that triggered it
- **Incremental Processing**: Only processes transfers newer than the last known block for each contract/account pair
- **Efficiency**: Prevents redundant RPC calls for already-processed transfers
- **Idempotency**: Can be run repeatedly without duplicating work

For detailed information about the continuous query implementation, see [CONTINUOUS_QUERIES.md](./CONTINUOUS_QUERIES.md).

### Running Continuous Updates

Simply run the balances service periodically to keep balances up-to-date:

```bash
# First run - processes all new transfers
npm run balances

# Subsequent runs - only processes transfers newer than previously seen blocks
npm run balances
```

## Backfill Mechanism

The backfill services process historical data from the end of the chain (highest block) to the beginning (lowest block):

- **Backward Processing**: Starts from the highest block number and works backwards
- **Skip Complete Records**: Only processes accounts that don't have balances at the highest block (already complete)
- **Continuous Operation**: Run repeatedly until all historical data is processed
- **Limit-based Batching**: Processes up to 10,000 transfers/accounts per run to avoid overwhelming the database

For detailed information about the backfill implementation, see [BACKFILL.md](./BACKFILL.md).

### Running Backfill Services

The backfill services are designed to run continuously until all historical data is processed:

```bash
# TRC20 backfill - processes up to 10,000 transfers per run
npm run backfill-trc20
# If output says "Run again to continue backfill", repeat the command

# Native backfill - processes up to 10,000 accounts per run  
npm run backfill-native
# If output says "Run again to continue backfill", repeat the command
```

**Use Cases:**
- **Initial Setup**: Fill in all historical balance data when first setting up the system
- **Gap Filling**: Process accounts that were skipped or failed in previous runs
- **Parallel Operation**: Can run alongside incremental services for maximum efficiency

```bash
# First run - processes all new transfers
npm run balances

# Subsequent runs - only processes transfers newer than previously seen blocks
npm run balances
```

## Tests

```bash
npm run test

=== ClickHouse Database Health Check ===

Target URL: http://localhost:8123

1. Checking DNS resolution...
✓ DNS resolution successful for localhost
  IP Addresses: 127.0.0.1

2. Pinging ClickHouse server...
✓ ClickHouse server is reachable at http://localhost:8123
  Response: Ok.

✅ All health checks passed!
```
