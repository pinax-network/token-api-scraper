# Backfill Services Documentation

## Overview

The backfill services are designed to process historical balance data from the end of the blockchain (highest block number) to the beginning (lowest block number). These services complement the existing incremental services by filling in historical data gaps.

## Services

### 1. TRC-20 Balances Backfill (`npm run backfill-erc20`)

**Purpose**: Process all historical TRC-20 token transfers to populate balance data.

**How it works**:
1. Queries the maximum block number from `trc20_transfer` table
2. Identifies accounts that don't have balances at the maximum block (incomplete)
3. Processes transfers from highest to lowest block number
4. Queries RPC for balance at each transfer's block number
5. Stores results in `trc20_balances_rpc` table with block_num

**SQL Query** (`sql/get_trc20_backfill_transfers.sql`):
```sql
-- Find max block number
-- Get balances that are already at max block (complete)
-- Return all transfers where accounts DON'T have balances at max block
-- Order by block_num DESC (highest first)
```

**Key Features**:
- Processes up to 10,000 transfers per run
- Skips accounts already complete (have balance at highest block)
- Handles both 'from' and 'to' addresses from transfers
- Excludes black hole address (T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb)

### 2. Native Balances Backfill (`npm run backfill-native`)

**Purpose**: Process all historical accounts to populate native token balance data.

**How it works**:
1. Identifies accounts from `trc20_transfer_agg` that don't have native balances
2. Orders accounts by their last seen block number (highest first)
3. Queries RPC for current native token balance
4. Stores results in `native_balances_rpc` table

**SQL Query** (`sql/get_native_backfill_accounts.sql`):
```sql
-- Get all accounts from transfer aggregation
-- Filter out accounts that already have native balances
-- Order by last_seen_block DESC (highest first)
```

**Key Features**:
- Processes up to 10,000 accounts per run
- Skips accounts that already have native balances
- Orders by highest block first for backward processing

## Comparison: Incremental vs Backfill

| Feature | Incremental Services | Backfill Services |
|---------|---------------------|-------------------|
| **Direction** | Process new data only | Process all historical data |
| **Ordering** | DESC by block (newest first) | DESC by block (highest first) |
| **Skip Logic** | Skip already processed blocks | Skip complete records (at max block) |
| **Use Case** | Ongoing updates | Initial setup, gap filling |
| **Frequency** | Run periodically | Run until complete |

### Incremental Services (Existing)
- `npm run balances` - TRC-20 balances
- `npm run native-balances` - Native balances
- Only process transfers newer than last known block per account
- Efficient for keeping data up-to-date

### Backfill Services (New)
- `npm run backfill-erc20` - TRC-20 balances backfill
- `npm run backfill-native` - Native balances backfill
- Process ALL data from highest block backward
- Efficient for filling historical gaps

## Usage Examples

### Initial Setup (Empty Database)

```bash
# Step 1: Run backfill to process historical data
npm run backfill-erc20
# Output: "Run again to continue backfill" if more data to process
npm run backfill-erc20
# Repeat until: "Backfill complete! Processed all available transfers."

# Step 2: Run native balances backfill
npm run backfill-native
# Repeat until complete

# Step 3: Set up incremental updates (cron job or scheduler)
npm run balances  # Daily
npm run native-balances  # Daily
```

### Filling Gaps in Existing Data

```bash
# Run backfill to catch any missed accounts
npm run backfill-erc20
# Will skip accounts already complete and process only incomplete ones

npm run backfill-native
# Will skip accounts that already have balances
```

### Parallel Operation (Maximum Throughput)

```bash
# Terminal 1: Process new data incrementally
npm run balances

# Terminal 2: Backfill historical data simultaneously
npm run backfill-erc20

# Terminal 3: Backfill native balances
npm run backfill-native
```

## Technical Details

### Block Number Tracking

Both incremental and backfill services use `block_num` to track progress:

- **ERC20 Balances**: Stores the block number of the transfer that triggered the balance query
- **Native Balances**: Doesn't store block_num (current balance is sufficient)

### Skip Logic

**Backfill TRC-20**:
```sql
WHERE (b_to.account IS NULL) OR (b_from.account IS NULL)
```
- Only processes accounts that DON'T have a balance at the maximum block
- Assumes if an account has a balance at max block, it's complete

**Incremental TRC-20**:
```sql
WHERE (t.block_num > lb_to.last_block_num) OR (lb_to.last_block_num IS NULL)
```
- Processes accounts that don't have a balance OR have an older block_num
- Always processes newer transfers

### Batching

- Both services use `LIMIT 10000` to prevent overwhelming the database
- Services automatically detect when more data needs processing
- Run repeatedly until services report "Backfill complete"

## Progress Monitoring

Both services provide comprehensive progress tracking:

```
🚀 Starting TRC-20 balances BACKFILL service with concurrency: 10
📝 This service processes transfers from highest to lowest block number
📝 It continues non-stop until the beginning of the chain

📋 Task Overview:
   Unique contracts: 150
   Unique accounts: 5000
   Total tasks to process: 10000

Progress: [████████████████████] 100% | ETA: 0s | 10000/10000 | Success: 9950 | Errors: 50 | Rate: 15.2/s

✅ Statistics Summary:
   Success: 9950 (99.5%)
   Errors: 50 (0.5%)
   Elapsed: 656s
   Avg Rate: 15.2 req/s

⚠️  Processed 10,000 transfers (limit reached). Run again to continue backfill.
```

## Prometheus Metrics

When enabled (`ENABLE_PROMETHEUS=true`), services expose metrics:

- `scraper_total_tasks` - Total tasks to process
- `scraper_completed_tasks_total` - Completed tasks (by status)
- `scraper_error_tasks_total` - Failed tasks
- `scraper_requests_per_second` - Current throughput
- `scraper_progress_percentage` - Completion percentage

Access at: `http://localhost:9090/metrics`

## Database Schema Requirements

Both services require:

**trc20_balances_rpc**:
- `block_num` column (UInt32)
- `is_ok` column (to filter successful queries)
- Indexes on `contract`, `account`, `block_num`

**native_balances_rpc**:
- `account` column
- Standard balance columns

## Error Handling

Both services handle errors gracefully:

1. Failed RPC calls are logged to error tables
2. Errors don't stop processing
3. Failed accounts can be retried on subsequent runs
4. Progress tracking shows error rates

## Performance Considerations

### Concurrency
- Default: 10 concurrent RPC requests
- Adjust via `CONCURRENCY` environment variable
- Higher values = faster but may hit rate limits
- Lower values = slower but more conservative

### Database Load
- 10,000 item limit per run prevents overwhelming DB
- Services can run in parallel (different processes)
- Indexes ensure efficient query performance

### RPC Node Load
- Concurrent requests spread across time
- Automatic retry for transient failures
- Rate limiting via concurrency control

## Monitoring and Maintenance

### Check Progress

```bash
# See how many transfers still need processing
echo "SELECT COUNT(*) FROM trc20_transfer WHERE block_num > (SELECT MAX(block_num) FROM trc20_balances_rpc)" | clickhouse-client

# See how many accounts need native balances
echo "SELECT COUNT(DISTINCT account) FROM trc20_transfer_agg WHERE account NOT IN (SELECT account FROM native_balances_rpc)" | clickhouse-client
```

### Verify Completion

Services will output one of:
- "Run again to continue backfill" - More data to process
- "Backfill complete! Processed all available transfers." - All done

### Resume After Interruption

Both services are idempotent:
- Can be stopped and restarted safely
- Will resume from where they left off
- Already processed accounts are skipped

## Troubleshooting

### Issue: Service keeps saying "Run again to continue"

**Solution**: This is normal. Keep running until you see "Backfill complete!"

### Issue: High error rate

**Solutions**:
- Check RPC node connectivity
- Reduce CONCURRENCY to be less aggressive
- Check ClickHouse connection
- Review error logs in error tables

### Issue: Service runs but no progress

**Solutions**:
- Verify database has transfer data: `SELECT COUNT(*) FROM trc20_transfer`
- Check that table schemas match requirements
- Verify RPC_URL is set correctly

### Issue: Service seems slow

**Solutions**:
- Increase CONCURRENCY (default 10, try 15-20)
- Check RPC node performance
- Monitor network latency
- Use multiple parallel instances

## Best Practices

1. **Initial Setup**: Run backfill services first, then set up incremental services
2. **Regular Backfills**: Periodically run backfill to catch any gaps
3. **Parallel Processing**: Run backfill and incremental services simultaneously
4. **Monitor Progress**: Use Prometheus metrics for production deployments
5. **Adjust Concurrency**: Tune based on RPC node capacity and error rates
6. **Database Indexes**: Ensure proper indexes for optimal query performance
