# Token API Scraper

A specialized tool for scraping and indexing TRC-20 token data on the TRON blockchain. This scraper continuously monitors token transfers and maintains up-to-date balance information.

## Features

- **TRC-20 Focus**: Designed specifically for TRON TRC-20 tokens
- **Continuous Query Mechanism**: Tracks block numbers to enable incremental balance updates
- **Efficient Processing**: Only queries new or updated transfers, avoiding redundant RPC calls
- **Progress Monitoring**: Real-time progress tracking with Prometheus metrics support
- **Concurrent Processing**: Configurable concurrency for optimal RPC throughput
- **RPC Batch Requests**: Optional batching of multiple RPC calls for improved performance

## Quick Start

### 1. Setup Database

```bash
# Deploy database schema to ClickHouse
npm run cli setup sql/schema.metadata.sql sql/schema.trc20_balances.sql
```

See [Database Setup Guide](docs/DATABASE_SETUP.md) for detailed instructions and cluster deployment.

### 2. Run Services

```bash
# Fetch token metadata
npm run cli run metadata

# Process TRC-20 balances (incremental)
npm run cli run trc20-balances

# Process native balances (incremental)
npm run cli run native-balances

# Backfill historical data (optional)
npm run cli run trc20-backfill --concurrency 15
npm run cli run native-backfill --concurrency 15
```

See [CLI Reference](docs/CLI.md) for all available commands and options.

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
- `NODE_URL` - EVM RPC node URL (default: `https://tron-evm-rpc.publicnode.com`)
- `CONCURRENCY` - Number of concurrent RPC requests (default: `10`)

See [Configuration Guide](docs/CONFIGURATION.md) for detailed information.

## Services Overview

### Incremental Services
Process only new data since the last run:
- **metadata** - Fetch token metadata (name, symbol, decimals)
- **trc20-balances** - Process new TRC-20 transfers
- **native-balances** - Process new accounts without balances

### Backfill Services
Process all historical data from newest to oldest:
- **trc20-backfill** - Backfill all TRC-20 historical transfers
- **native-backfill** - Backfill all historical accounts

**When to use backfill:**
- Initial setup: Fill in all historical balance data
- Gap filling: Process accounts missed in previous runs
- Parallel operation: Run alongside incremental services for maximum throughput

See [Backfill Documentation](docs/BACKFILL.md) and [Continuous Queries Documentation](docs/CONTINUOUS_QUERIES.md) for implementation details.

## Docker

Run in containerized environments:

```bash
# Build image
docker build -t token-api-scraper .

# Run service
docker run \
  -e CLICKHOUSE_URL=http://clickhouse:8123 \
  -e NODE_URL=https://tron-evm-rpc.publicnode.com \
  token-api-scraper run metadata
```

See [Docker Guide](docs/DOCKER.md) for Docker Compose examples and production deployment.

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
- [Continuous Queries](docs/CONTINUOUS_QUERIES.md) - Incremental processing implementation
- [Backfill Services](docs/BACKFILL.md) - Historical data processing
- [RPC Batch Requests](docs/RPC_BATCH.md) - Batching multiple RPC calls for better performance
- [Proto Fix](docs/PROTO_FIX.md) - TronWeb compatibility workaround

## Known Issues

### TronWeb Proto Variable Error

If you encounter a `ReferenceError: Can't find variable: proto` error, this is a known issue with TronWeb 6.0.4's generated protobuf files. We've implemented a polyfill to fix this. See [docs/PROTO_FIX.md](docs/PROTO_FIX.md) for details.

## License

See [LICENSE](LICENSE) for details.
