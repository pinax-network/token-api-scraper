# Substreams Tron Scraper

## Quickstart

```bash
npm run start
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
