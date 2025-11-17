# Configuration Guide

This document describes all configuration options available for the Token API Scraper.

## Environment Variables

The application can be configured via environment variables. Copy `.env.example` to `.env` and adjust the settings:

```bash
cp .env.example .env
```

### Database Configuration

- **`CLICKHOUSE_URL`** - ClickHouse database URL
  - Default: `http://localhost:8123`
  - Example: `http://clickhouse.example.com:8123`

- **`CLICKHOUSE_USERNAME`** - ClickHouse username
  - Default: `default`

- **`CLICKHOUSE_PASSWORD`** - ClickHouse password
  - Default: (empty)

- **`CLICKHOUSE_DATABASE`** - ClickHouse database name
  - Default: `default`

### RPC Configuration

- **`NODE_URL`** - EVM RPC node URL
  - Default: `https://tron-evm-rpc.publicnode.com`
  - Example: `https://your-tron-node.example.com`

### Performance Settings

#### Concurrency

- **`CONCURRENCY`** - Number of concurrent RPC requests
  - Default: `10`
  - Recommended range: `5-20`, depending on RPC node capacity and network conditions
  - Higher values: Faster processing but may hit rate limits
  - Lower values: Slower but more conservative on RPC resources

Example:
```bash
# Set concurrency to 5 for conservative processing
CONCURRENCY=5 npm run start
```

#### Retry Configuration

The retry mechanism uses exponential backoff with jitter to handle transient RPC failures gracefully:

- **`MAX_RETRIES`** - Maximum number of retry attempts for failed RPC requests
  - Default: `3`
  - Controls how many times to retry a failed request

- **`BASE_DELAY_MS`** - Base delay in milliseconds for exponential backoff between retries
  - Default: `400`
  - Starting delay between retries, which grows exponentially

- **`JITTER_MIN`** - Minimum jitter multiplier for backoff delay
  - Default: `0.7` (70% of backoff)
  - Add randomness to retry delays to prevent thundering herd

- **`JITTER_MAX`** - Maximum jitter multiplier for backoff delay
  - Default: `1.3` (130% of backoff)

- **`MAX_DELAY_MS`** - Maximum delay in milliseconds between retry attempts
  - Default: `30000` (30 seconds)
  - Cap on the maximum delay between retries

- **`TIMEOUT_MS`** - Timeout in milliseconds for individual RPC requests
  - Default: `10000` (10 seconds)
  - How long to wait for a single RPC request before timing out

Example:
```bash
# More aggressive retry settings for unreliable networks
MAX_RETRIES=5 BASE_DELAY_MS=1000 MAX_DELAY_MS=60000 npm run start
```

### Monitoring Configuration

#### Prometheus Metrics

- **`ENABLE_PROMETHEUS`** - Enable Prometheus metrics endpoint
  - Default: `false`
  - Set to `true` to enable metrics collection

- **`PROMETHEUS_PORT`** - Prometheus metrics HTTP port
  - Default: `9090`
  - Port where metrics will be exposed

Example:
```bash
# Enable Prometheus metrics on default port 9090
ENABLE_PROMETHEUS=true npm run start

# Or specify a custom port
ENABLE_PROMETHEUS=true PROMETHEUS_PORT=8080 npm run start
```

**Available Metrics:**
- `scraper_total_tasks` - Total number of tasks to process
- `scraper_completed_tasks_total` - Total number of completed tasks (labeled by status: success/error)
- `scraper_error_tasks_total` - Total number of failed tasks
- `scraper_requests_per_second` - Current requests per second
- `scraper_progress_percentage` - Current progress percentage

Access metrics at: `http://localhost:9090/metrics` (or your configured port)

## Configuration Priority

Configuration values are applied in the following order (later values override earlier ones):

1. Default values (hardcoded in the application)
2. Environment variables (from `.env` file or system environment)
3. Command-line flags (highest priority)

Example showing all three:
```bash
# .env file
CONCURRENCY=10

# Command-line flag overrides .env
npm run cli run metadata --concurrency 20
```

## Configuration Files

### .env File

Create a `.env` file in the project root with your configuration:

```bash
# Database
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USERNAME=default
CLICKHOUSE_PASSWORD=secret
CLICKHOUSE_DATABASE=evm_data

# RPC
NODE_URL=https://tron-evm-rpc.publicnode.com

# Performance
CONCURRENCY=15
MAX_RETRIES=5

# Monitoring
ENABLE_PROMETHEUS=true
PROMETHEUS_PORT=9090
```

### Example Configurations

#### Development Setup
```bash
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USERNAME=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=default
NODE_URL=https://tron-evm-rpc.publicnode.com
CONCURRENCY=5
ENABLE_PROMETHEUS=false
```

#### Production Setup
```bash
CLICKHOUSE_URL=http://clickhouse-cluster:8123
CLICKHOUSE_USERNAME=scraper_user
CLICKHOUSE_PASSWORD=secure_password_here
CLICKHOUSE_DATABASE=production_evm
NODE_URL=https://your-tron-node.example.com
CONCURRENCY=20
MAX_RETRIES=5
BASE_DELAY_MS=500
MAX_DELAY_MS=60000
ENABLE_PROMETHEUS=true
PROMETHEUS_PORT=9090
```

## Performance Tuning

### Optimizing for Speed

For maximum throughput when you have a reliable RPC node:

```bash
CONCURRENCY=20
MAX_RETRIES=3
TIMEOUT_MS=5000
```

### Optimizing for Reliability

For unstable networks or rate-limited RPC nodes:

```bash
CONCURRENCY=5
MAX_RETRIES=10
BASE_DELAY_MS=1000
MAX_DELAY_MS=120000
TIMEOUT_MS=30000
```

### Balanced Configuration

A good middle ground for most use cases:

```bash
CONCURRENCY=10
MAX_RETRIES=5
BASE_DELAY_MS=400
MAX_DELAY_MS=30000
TIMEOUT_MS=10000
```

## Troubleshooting Configuration Issues

### High Error Rates

If you see many RPC errors:
- Reduce `CONCURRENCY` to be less aggressive
- Increase `MAX_RETRIES` for more retry attempts
- Increase `TIMEOUT_MS` if requests are timing out
- Check your `NODE_URL` is correct and accessible

### Slow Performance

If processing is slower than expected:
- Increase `CONCURRENCY` (if RPC node can handle it)
- Decrease `TIMEOUT_MS` to fail faster
- Verify network connectivity to RPC node
- Check database performance

### Connection Issues

If you can't connect to ClickHouse:
- Verify `CLICKHOUSE_URL` is correct
- Check firewall rules allow connection
- Verify credentials (`CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD`)
- Test connection: `curl http://localhost:8123/ping`
