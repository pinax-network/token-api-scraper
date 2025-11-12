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

# Run TRC20 balances RPC service
npm run cli run trc20-balances

# Run Native balances RPC service
npm run cli run native-balances

# Run with custom parameters
npm run cli run metadata --concurrency 20 --enable-prometheus
```

### Using npm scripts (legacy)

```bash
# Run metadata RPC service
npm run start

# Run TRC20 balances RPC service
npm run balances

# Run Native balances RPC service
npm run native-balances

# Run tests
npm run test
```

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

# Run with command-line flags
docker run substreams-tron-scraper run trc20-balances --concurrency 20 --enable-prometheus
```

### Docker Compose Example

```yaml
version: '3.8'
services:
  scraper:
    build: .
    environment:
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_USERNAME=default
      - CLICKHOUSE_PASSWORD=password
      - CLICKHOUSE_DATABASE=default
      - NODE_URL=https://tron-evm-rpc.publicnode.com
      - CONCURRENCY=10
    command: run metadata
```

## Continuous Query Mechanism

The TRC20 balances service uses an intelligent continuous query mechanism that tracks block numbers to enable incremental updates:

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
