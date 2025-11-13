# Continuous Queries Implementation

## Overview

This document describes the continuous query mechanism implemented for the TRC-20 balances scraper service. The system tracks the last processed block number for each contract/account pair to enable incremental updates and avoid redundant RPC calls.

## Architecture

### Block Number Tracking

The `trc20_balances_rpc` table now includes a `block_num` field that stores the block number of the transfer event that triggered the balance query. This allows the system to:

1. Track which block was last processed for each balance
2. Skip transfers that have already been processed
3. Only query balances for new or updated transfer events

### Query Flow

```
1. Query trc20_balances_rpc to get the highest block_num per contract/account pair
2. Query trc20_transfer for transfers where:
   - The account doesn't exist in balances yet, OR
   - The transfer's block_num is greater than the last known block for that account
3. Process only the new/updated balances via RPC
4. Store the results with the transfer's block_num
```

## SQL Implementation

### get_latest_transfers.sql

The query uses CTEs (Common Table Expressions) to:

1. **balances CTE**: Get all existing balances with their block numbers (only successful ones with `is_ok = 1`)
2. **latest_blocks CTE**: Calculate the MAX block_num for each contract/account pair
3. **Main Query**: JOIN transfers with latest blocks for both 'to' and 'from' accounts
   - Uses LEFT JOIN to include accounts not yet in the balances table
   - Filters to only include transfers newer than the last known block
   - Orders by block_num DESC to process newest transfers first

```sql
WITH balances AS (
    SELECT contract, account, block_num
    FROM trc20_balances_rpc
    WHERE is_ok = 1
),
latest_blocks AS (
    SELECT contract, account, MAX(block_num) as last_block_num
    FROM balances
    GROUP BY contract, account
)
SELECT DISTINCT
    t.log_address,
    t.`from`,
    t.`to`,
    t.block_num
FROM trc20_transfer t
LEFT JOIN latest_blocks lb_to ON (t.log_address = lb_to.contract AND t.`to` = lb_to.account)
LEFT JOIN latest_blocks lb_from ON (t.log_address = lb_from.contract AND t.`from` = lb_from.account)
WHERE
    (lb_to.last_block_num IS NULL OR t.block_num > lb_to.last_block_num)
    OR (lb_from.last_block_num IS NULL OR t.block_num > lb_from.last_block_num)
ORDER BY t.block_num DESC
LIMIT 10000;
```

## Benefits

### Efficiency
- **Reduced RPC Calls**: Only queries balances for new or updated transfers
- **Incremental Processing**: Can run continuously without reprocessing old data
- **Resource Optimization**: Minimizes load on both the database and RPC nodes

### Data Integrity
- **Block Tracking**: Maintains a clear audit trail of when each balance was last checked
- **Idempotency**: Re-running the service won't duplicate work for already-processed blocks
- **Recoverability**: If a balance query fails, it can be retried on the next run

### Scalability
- **Bounded Queries**: The LIMIT clause ensures queries don't become too large
- **Index-Friendly**: Uses indexed columns (contract, account, block_num) for efficient lookups
- **Parallel Processing**: Multiple instances can run simultaneously without conflicts

## Usage

The service automatically uses this mechanism when started:

```bash
# Run once to process latest transfers
bun run balances

# Can be run repeatedly - only processes new data each time
bun run balances
```

## Database Schema Requirements

The `trc20_balances_rpc` table must include:
- `block_num` column (UInt32 or similar integer type)
- `is_ok` column (to filter successful balance queries)
- Appropriate indexes on `contract`, `account`, and `block_num` for query performance

Example schema addition:
```sql
ALTER TABLE trc20_balances_rpc
    ADD COLUMN IF NOT EXISTS block_num UInt32 DEFAULT 0,
    ADD INDEX IF NOT EXISTS idx_block_num (block_num) TYPE minmax GRANULARITY 1;
```

## Monitoring

The service provides progress tracking that shows:
- Total unique contracts and accounts discovered
- Number of tasks processed
- Success/error rates
- Processing time and throughput

This helps verify that the continuous query mechanism is working correctly and efficiently.
