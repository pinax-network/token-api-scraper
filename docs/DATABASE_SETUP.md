# Database Setup Guide

This document provides detailed instructions for setting up the ClickHouse database for the Token API Scraper.

## Overview

The Token API Scraper requires specific database tables and helper functions to store and process blockchain data. The `setup` command handles deployment of SQL schema files to your ClickHouse database.

## Prerequisites

- ClickHouse server installed and running
- Network access to ClickHouse server
- Appropriate permissions to create databases, tables, and functions

## Quick Setup

The fastest way to get started:

```bash
# Deploy all schema files to ClickHouse
npm run cli setup sql/schema.metadata.sql
```

This creates all necessary:
- Helper functions
- Tables with appropriate engines
- Indexes for optimal query performance

## Schema Files

The project includes two main schema files:

### 1. schema.metadata.sql

**Purpose**: Stores token metadata (name, symbol, decimals)

**Contents**:
- **Helper Functions**:
  - `hex_to_string()` - Converts hex strings to readable strings
  - `hex_to_uint256()` - Converts hex strings to UInt256 numbers

- **Tables**:
  - `metadata_rpc` - Stores token metadata from smart contracts
  - Uses `ReplacingMergeTree` engine for automatic deduplication
  - Columns: `chain`, `contract`, `name`, `symbol`, `decimals`, `is_ok`, `error`

**Deployment**:
```bash
npm run cli setup sql/schema.metadata.sql
```

### 2. schema.erc20_balances.sql

**Purpose**: Stores token and native balance data

**Contents**:
- **Helper Functions**:
  - `hex_to_uint256()` - Converts hex strings to UInt256 numbers
  - `format_balance()` - Formats balance with decimals

- **Tables**:
  - `erc20_balances_rpc` - ERC-20 token balances with block number tracking
  - `native_balances_rpc` - Native token balances
  - Both use `MergeTree` engine with appropriate sorting keys

**Deployment**:
```bash
npm run cli setup sql/schema.erc20_balances.sql
```

## Deployment Options

### Single Database

Deploy to a single ClickHouse instance:

```bash
# Deploy all schemas
npm run cli setup sql/schema.*.sql

# Deploy individual schemas
npm run cli setup sql/schema.metadata.sql
```

### Custom Database Connection

Specify connection parameters:

```bash
npm run cli setup sql/schema.*.sql \
  --clickhouse-url http://localhost:8123 \
  --clickhouse-username default \
  --clickhouse-password secret \
  --clickhouse-database my_database
```

### ClickHouse Cluster

For clustered deployments, use the `--cluster` flag. This automatically:
- Adds `ON CLUSTER '<name>'` to CREATE TABLE and ALTER TABLE statements
- Adds `ON CLUSTER '<name>'` to CREATE FUNCTION statements
- Adds `ON CLUSTER '<name>'` to CREATE MATERIALIZED VIEW statements
- Converts `MergeTree` engines to `ReplicatedMergeTree`
- Converts `ReplacingMergeTree` to `ReplicatedReplacingMergeTree`

```bash
# Deploy to a cluster
npm run cli setup sql/schema.*.sql --cluster my_cluster

# Deploy to cluster with custom settings
npm run cli setup sql/schema.*.sql \
  --cluster production_cluster \
  --clickhouse-url http://clickhouse-node1:8123 \
  --clickhouse-database evm_data
```

## Table Schemas

### metadata_rpc

Stores token metadata fetched from smart contracts.

```sql
CREATE TABLE IF NOT EXISTS metadata_rpc
(
    chain String,
    contract String,
    name String,
    symbol String,
    decimals UInt8,
    is_ok UInt8,
    error String
)
ENGINE = ReplacingMergeTree()
ORDER BY (chain, contract)
```

**Columns**:
- `chain` - Blockchain identifier
- `contract` - Token contract address
- `name` - Token name (e.g., "Tether USD")
- `symbol` - Token symbol (e.g., "USDT")
- `decimals` - Number of decimal places
- `is_ok` - Success flag (1 = success, 0 = error)
- `error` - Error message if query failed

**Engine**: `ReplacingMergeTree` - Automatically deduplicates rows with the same `ORDER BY` key

### erc20_balances_rpc

Stores ERC-20 token balances with block number tracking.

```sql
CREATE TABLE IF NOT EXISTS erc20_balances_rpc
(
    chain String,
    contract String,
    account String,
    balance String,
    block_num UInt32,
    is_ok UInt8,
    error String
)
ENGINE = MergeTree()
ORDER BY (chain, contract, account, block_num)
```

**Columns**:
- `chain` - Blockchain identifier
- `contract` - Token contract address
- `account` - Wallet address
- `balance` - Token balance (as string to handle large numbers)
- `block_num` - Block number when balance was queried
- `is_ok` - Success flag (1 = success, 0 = error)
- `error` - Error message if query failed

**Engine**: `MergeTree` - Optimized for analytical queries

**Indexes**: Automatically created on `(chain, contract, account, block_num)` for efficient lookups

### native_balances_rpc

Stores native token balances.

```sql
CREATE TABLE IF NOT EXISTS native_balances_rpc
(
    chain String,
    account String,
    balance String,
    is_ok UInt8,
    error String
)
ENGINE = MergeTree()
ORDER BY (chain, account)
```

**Columns**:
- `chain` - Blockchain identifier
- `account` - Wallet address
- `balance` - Native token balance
- `is_ok` - Success flag (1 = success, 0 = error)
- `error` - Error message if query failed

**Engine**: `MergeTree` - Optimized for analytical queries

## Helper Functions

### hex_to_string()

Converts hexadecimal strings to readable strings.

```sql
CREATE FUNCTION IF NOT EXISTS hex_to_string AS (hex_str) ->
    if(hex_str = '' OR hex_str IS NULL, '',
       replaceRegexpAll(unhex(replaceAll(hex_str, '0x', '')), '\0', ''))
```

**Usage**:
```sql
SELECT hex_to_string('0x54657468657220555344') AS name;
-- Result: Tether USD
```

### hex_to_uint256()

Converts hexadecimal strings to UInt256 numbers.

```sql
CREATE FUNCTION IF NOT EXISTS hex_to_uint256 AS (hex_str) ->
    if(hex_str = '' OR hex_str IS NULL, toUInt256(0),
       reinterpretAsUInt256(reverse(unhex(replaceAll(hex_str, '0x', '')))))
```

**Usage**:
```sql
SELECT hex_to_uint256('0x0de0b6b3a7640000') AS balance;
-- Result: 1000000000000000000
```

### format_balance()

Formats balance with decimal places.

```sql
CREATE FUNCTION IF NOT EXISTS format_balance AS (balance_str, decimals) ->
    if(decimals = 0, balance_str,
       concat(
           toString(toUInt256(balance_str) / pow(10, decimals)),
           '.',
           toString(toUInt256(balance_str) % pow(10, decimals))
       ))
```

**Usage**:
```sql
SELECT format_balance('1000000000000000000', 18) AS formatted;
-- Result: 1.0
```

## Database Requirements

### ClickHouse Version

Recommended: ClickHouse 21.3 or later

Required features:
- UInt256 support
- User-defined functions
- ReplacingMergeTree engine

### Disk Space

Estimate storage requirements based on:
- Number of tokens
- Number of unique accounts
- Historical depth

Typical usage:
- Metadata: ~1 MB per 1,000 tokens

### Performance Considerations

**Indexes**: The schemas include appropriate indexes for:
- Token contract lookups
- Account balance queries
- Block number range queries

**Partitioning**: Consider partitioning large tables:
```sql
ALTER TABLE erc20_balances_rpc
MODIFY PARTITION BY toYYYYMM(toDate(block_num))
```

**Materialized Views**: Create views for common queries:
```sql
CREATE MATERIALIZED VIEW latest_balances AS
SELECT
    contract,
    account,
    argMax(balance, block_num) AS balance
FROM erc20_balances_rpc
WHERE is_ok = 1
GROUP BY contract, account
```

## Cluster Configuration

### Replicated Tables

When using `--cluster`, tables are automatically configured for replication:

```sql
CREATE TABLE IF NOT EXISTS metadata_rpc ON CLUSTER production_cluster
(
    -- columns
)
ENGINE = ReplicatedReplacingMergeTree('/clickhouse/tables/{shard}/metadata_rpc', '{replica}')
ORDER BY (chain, contract)
```

### Distributed Tables

For query optimization across shards:

```sql
CREATE TABLE IF NOT EXISTS metadata_rpc_distributed ON CLUSTER production_cluster AS metadata_rpc
ENGINE = Distributed(production_cluster, default, metadata_rpc, rand())
```

## Verification

### Check Tables

```bash
# List all tables
echo "SHOW TABLES" | clickhouse-client

# Check table structure
echo "DESCRIBE TABLE metadata_rpc" | clickhouse-client

# Check row counts
echo "SELECT COUNT(*) FROM metadata_rpc" | clickhouse-client
```

### Test Functions

```bash
# Test hex_to_string
echo "SELECT hex_to_string('0x54657468657220555344')" | clickhouse-client

# Test hex_to_uint256
echo "SELECT hex_to_uint256('0x0de0b6b3a7640000')" | clickhouse-client

# Test format_balance
echo "SELECT format_balance('1000000000000000000', 18)" | clickhouse-client
```

### Health Check

The project includes a database health check script:

```bash
npm run check-db
```

Output:
```
=== ClickHouse Database Health Check ===

Target URL: http://localhost:8123

1. Checking DNS resolution...
✓ DNS resolution successful for localhost

2. Pinging ClickHouse server...
✓ ClickHouse server is reachable at http://localhost:8123

✅ All health checks passed!
```

## Migration and Updates

### Schema Updates

To update schemas:

1. Modify the SQL file
2. Re-run the setup command
3. The `IF NOT EXISTS` clauses prevent errors

```bash
npm run cli setup sql/schema.*.sql
```

### Adding Indexes

```sql
ALTER TABLE metadata_rpc
ADD INDEX idx_contract (contract) TYPE minmax GRANULARITY 1;
```

### Adding Columns

```sql
ALTER TABLE metadata_rpc
ADD COLUMN IF NOT EXISTS timestamp DateTime DEFAULT now();
```

## Backup and Restore

### Backup

```bash
# Backup table data
clickhouse-client --query "SELECT * FROM metadata_rpc FORMAT Native" > metadata_rpc.native

# Backup schema
clickhouse-client --query "SHOW CREATE TABLE metadata_rpc" > metadata_rpc.sql
```

### Restore

```bash
# Restore schema
clickhouse-client < metadata_rpc.sql

# Restore data
cat metadata_rpc.native | clickhouse-client --query "INSERT INTO metadata_rpc FORMAT Native"
```

## Troubleshooting

### Connection Refused

```bash
# Check if ClickHouse is running
curl http://localhost:8123/ping

# Check firewall
sudo ufw status

# Check ClickHouse logs
sudo tail -f /var/log/clickhouse-server/clickhouse-server.log
```

### Permission Denied

```bash
# Grant permissions
echo "GRANT ALL ON database.* TO user" | clickhouse-client
```

### Schema Already Exists

The setup command uses `IF NOT EXISTS` clauses, so it's safe to run multiple times. If you need to recreate tables:

```sql
DROP TABLE IF EXISTS metadata_rpc;
```

Then re-run:
```bash
npm run cli setup sql/schema.*.sql
```

### Function Already Exists

Functions use `CREATE FUNCTION IF NOT EXISTS`, so re-running setup is safe.

## Best Practices

1. **Always backup** before schema changes
2. **Test in development** before production deployment
3. **Use clusters** for production workloads
4. **Monitor disk space** as data grows
5. **Create indexes** for frequently queried columns
6. **Use materialized views** for common aggregations
7. **Partition large tables** by date or block number
8. **Regular maintenance**: Run `OPTIMIZE TABLE` periodically

## Additional Resources

- [ClickHouse Documentation](https://clickhouse.com/docs)
- [MergeTree Family](https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/)
- [Distributed Engine](https://clickhouse.com/docs/en/engines/table-engines/special/distributed/)
- [User-Defined Functions](https://clickhouse.com/docs/en/sql-reference/functions/user-defined-functions/)
