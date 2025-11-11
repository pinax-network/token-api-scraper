# Substreams Tron Scraper

## Quickstart

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
