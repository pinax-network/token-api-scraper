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
  - Default: `true`
  - Set to `false` to disable metrics collection

- **`PROMETHEUS_PORT`** - Prometheus metrics HTTP port
  - Default: `9090`
  - Port where metrics will be exposed

Example:
```bash
# Prometheus metrics are enabled by default on port 9090
npm run start

# Disable Prometheus metrics if not needed
ENABLE_PROMETHEUS=false npm run start

# Or specify a custom port
PROMETHEUS_PORT=8080 npm run start
```

**Available Metrics:**
- `scraper_total_tasks` - Total number of tasks to process
- `scraper_completed_tasks_total` - Total number of completed tasks (labeled by status: success/error)
- `scraper_error_tasks_total` - Total number of failed tasks
- `scraper_requests_per_second` - Current requests per second
- `scraper_progress_percentage` - Current progress percentage

Access metrics at: `http://localhost:9090/metrics` (or your configured port)

#### Batch Insert Configuration

The batch insert mechanism improves ClickHouse insert performance by accumulating rows and inserting them in batches instead of one-by-one. This significantly reduces database overhead and improves throughput.

**Batch inserts are always enabled** to ensure optimal performance. You can configure the batching behavior with the following settings:

- **`BATCH_INSERT_INTERVAL_MS`** - Flush interval in milliseconds
  - Default: `1000` (1 second)
  - How often to flush accumulated inserts to ClickHouse
  - Lower values: More frequent inserts, lower latency
  - Higher values: Larger batches, better throughput

- **`BATCH_INSERT_MAX_SIZE`** - Maximum batch size before forcing a flush
  - Default: `10000` rows
  - Flush immediately when this many rows are accumulated
  - Prevents memory issues with large queues
  - Adjust based on available memory and row size

Example:
```bash
# Default batch settings (1 second, 10000 rows)
npm run start

# Custom batch settings for high-throughput scenarios
BATCH_INSERT_INTERVAL_MS=5000 BATCH_INSERT_MAX_SIZE=50000 npm run start

# Lower latency configuration (more frequent flushes)
BATCH_INSERT_INTERVAL_MS=500 BATCH_INSERT_MAX_SIZE=5000 npm run start
```

**Batch insert benefits:**
- Improved insert throughput for large volumes of data
- Reduced database overhead and network calls
- Better resource utilization in high-concurrency scenarios

#### RPC Batch Requests

The RPC batch requests feature allows you to send multiple RPC calls in a single HTTP request, which can significantly improve performance when making many small RPC calls.

- **`RPC_BATCH_ENABLED`** - Enable RPC batch requests
  - Default: `false`
  - Set to `true` to enable batching of RPC requests

- **`RPC_BATCH_SIZE`** - Maximum number of requests per RPC batch
  - Default: `10`
  - How many RPC calls to batch together in a single request

Example:
```bash
# Enable RPC batching with default batch size
RPC_BATCH_ENABLED=true npm run start

# Enable RPC batching with custom batch size
RPC_BATCH_ENABLED=true RPC_BATCH_SIZE=20 npm run start
```

### Auto-restart Options

Services can be configured to automatically restart after successful completion, which is useful for continuous monitoring and incremental updates:

- **`AUTO_RESTART`** - Automatically restart the service after it completes successfully
  - Default: `false`
  - Set to `true` to enable auto-restart
  - Only restarts after successful completion (exit code 0)

- **`AUTO_RESTART_DELAY`** - Delay in seconds before restarting the service
  - Default: `10`
  - Minimum: `1` second
  - Time to wait before restarting the service

Example:
```bash
# Enable auto-restart with default 10 second delay
AUTO_RESTART=true npm run cli run metadata-transfers

# Enable auto-restart with custom 30 second delay
AUTO_RESTART=true AUTO_RESTART_DELAY=30 npm run cli run metadata-swaps

# Combine with other options
AUTO_RESTART=true AUTO_RESTART_DELAY=60 CONCURRENCY=20 npm run cli run balances-erc20
```

### Logging Options

- **`VERBOSE`** - Enable verbose logging output
  - Default: `false`
  - Set to `true` to enable detailed console output
  - When disabled, only errors are shown
  - Prometheus metrics are still computed regardless of this setting

Example:
```bash
# Run with verbose logging
VERBOSE=true npm run cli run metadata-transfers

# Run silently (default)
npm run cli run metadata-transfers
```

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
# ENABLE_PROMETHEUS=false  # Uncomment to disable metrics
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
# ENABLE_PROMETHEUS=true  # Already enabled by default
PROMETHEUS_PORT=9090
BATCH_INSERT_INTERVAL_MS=1000
BATCH_INSERT_MAX_SIZE=10000
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
