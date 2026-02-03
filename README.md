# Token API Scraper

A specialized tool for scraping and indexing ERC-20 token data on the TRON blockchain. This scraper continuously monitors token transfers and maintains up-to-date balance information.

## Features

- **ERC-20 Focus**: Designed specifically for TRON ERC-20 tokens
- **Continuous Query Mechanism**: Tracks block numbers to enable incremental balance updates
- **Efficient Processing**: Only queries new or updated transfers, avoiding redundant RPC calls
- **Prometheus Metrics**: Real-time monitoring with comprehensive metrics (see [Monitoring](#monitoring))
- **Concurrent Processing**: Configurable concurrency for optimal RPC throughput
- **RPC Batch Requests**: Optional batching of multiple RPC calls for improved performance

## Quick Start

### 1. Setup Database

```bash
# Deploy EVM metadata schemas to ClickHouse
npm run cli setup metadata-evm

# Deploy Solana metadata schemas to ClickHouse
npm run cli setup metadata-solana

# Or deploy custom SQL files
npm run cli setup files sql.schemas/schema.metadata_evm.sql
```

See [Database Setup Guide](docs/DATABASE_SETUP.md) for detailed instructions and cluster deployment.

### 2. Run Services

```bash
# Fetch token metadata Transfers/Swaps/Balances
npm run cli run metadata-transfers
npm run cli run metadata-swaps
npm run cli run metadata-balances

# Fetch Solana token metadata
npm run cli run metadata-solana
```

See [CLI Reference](docs/CLI.md) for all available commands and options.

### Troubleshooting Token Metadata

Use the `query` commands to debug individual token metadata fetching without storing results in ClickHouse:

```bash
# Query EVM token metadata (TRON/Ethereum)
npm run cli query metadata-evm TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t  # USDT on TRON
npm run cli query metadata-evm 0xdAC17F958D2ee523a2206206994597C13D831ec7  # EVM hex format

# Query Solana token metadata
npm run cli query metadata-solana So11111111111111111111111111111111111111112

# Query Solana LP token metadata
npm run cli query metadata-solana-extras <mint>
```

### 3. Configuration

Set configuration via environment variables or command-line flags:

```bash
# Copy example configuration
cp .env.example .env

# Edit .env with your settings
# See docs/CONFIGURATION.md for all options
```

Key environment variables:

- `CLICKHOUSE_URL` - ClickHouse database URL (default: `http://localhost:8123`)
- `NODE_URL` - EVM RPC node URL (required)
- `CONCURRENCY` - Number of concurrent RPC requests (default: `10`)
- `LOG_LEVEL` - Minimum log level (default: `info`)
  - `debug` - Detailed debugging information (RPC calls, internal state)
  - `info` - General operational messages (service start, completions)
  - `warn` - Warning conditions (retries, non-fatal errors)
  - `error` - Error conditions only (failures, exceptions)
  - Messages at or above the set level are shown

See [Configuration Guide](docs/CONFIGURATION.md) for detailed information.

## Services Overview

### Incremental Services

Process only new data since the last run:

- **metadata** - Fetch token metadata (name, symbol, decimals) from swaps & transfers

## Docker

Run in containerized environments:

```bash
# Build image
docker build -t token-api-scraper .

# Run service
docker run --env-file .env -p 9090:9090 token-api-scraper \
    run metadata-swaps --verbose --auto-restart
```

See [Docker Guide](docs/DOCKER.md) for Docker Compose examples and production deployment.

## Monitoring

The scraper exposes Prometheus metrics on port `9090` (configurable via `PROMETHEUS_PORT`).

### Available Metrics

**ClickHouse Operations**
- `scraper_clickhouse_operations` (histogram) - Duration of ClickHouse operations in seconds
  - Labels: `operation_type` (`read`, `write`), `status` (`success`, `error`)
  - Automatically tracked in `lib/clickhouse.ts` and `lib/batch-insert.ts`

**RPC Requests**
- `scraper_rpc_requests` (histogram) - Duration of RPC requests in seconds
  - Labels: `method` (e.g., `eth_call`, `eth_getBalance`), `status` (`success`, `error`)
  - Automatically tracked in `lib/rpc.ts`

**Task Completion**
- `scraper_completed_tasks_total` (counter) - Total completed tasks
  - Labels: `service`, `status` (`success`, `error`)
- `scraper_error_tasks_total` (counter) - Total failed tasks
  - Labels: `service`

**Configuration Info**
- `scraper_config_info` (gauge) - Configuration metadata
  - Labels: `clickhouse_url`, `clickhouse_database`, `node_url`

### Accessing Metrics

```bash
# View metrics endpoint
curl http://localhost:9090/metrics

# Example Prometheus queries
scraper_clickhouse_operations_bucket{operation_type="write"}
rate(scraper_rpc_requests_count{status="success"}[5m])
histogram_quantile(0.95, scraper_clickhouse_operations_bucket{operation_type="read"})
```

## Testing

```bash
npm run test
```

Example output:

```
=== ClickHouse Database Health Check ===

Target URL: http://localhost:8123

1. Checking DNS resolution...
✓ DNS resolution successful for localhost

2. Pinging ClickHouse server...
✓ ClickHouse server is reachable at http://localhost:8123

✅ All health checks passed!
```

## Documentation

- [CLI Reference](docs/CLI.md) - Complete CLI command documentation
- [Configuration Guide](docs/CONFIGURATION.md) - Environment variables and configuration options
- [Database Setup](docs/DATABASE_SETUP.md) - Database schema and setup instructions
- [Docker Guide](docs/DOCKER.md) - Docker and container orchestration
- [RPC Batch Requests](docs/RPC_BATCH.md) - Batching multiple RPC calls for better performance
- [Proto Fix](docs/PROTO_FIX.md) - TronWeb compatibility workaround

## Known Issues

### TronWeb Proto Variable Error

If you encounter a `ReferenceError: Can't find variable: proto` error, this is a known issue with TronWeb 6.0.4's generated protobuf files. We've implemented a polyfill to fix this. See [docs/PROTO_FIX.md](docs/PROTO_FIX.md) for details.

## License

See [LICENSE](LICENSE) for details.
