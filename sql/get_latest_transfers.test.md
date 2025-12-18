# Test Cases for get_latest_transfers.sql

This document outlines test cases to verify the continuous query logic works correctly.

## Test Scenario 1: First Run (Empty Balances Table)

**Setup:**
- `erc20_balances_rpc` is empty
- `erc20_transfer` has 100 transfers

**Expected Result:**
- Query returns all 100 transfers (up to LIMIT)
- Both 'to' and 'from' accounts are included since no balances exist yet

**Verification:**
```sql
-- Should return transfers since LEFT JOIN with empty table returns NULL
SELECT COUNT(*) FROM erc20_transfer; -- Should match result count (up to 10000)
```

## Test Scenario 2: Subsequent Run (Some Balances Exist)

**Setup:**
- `erc20_balances_rpc` has balances for accounts A, B, C at block 1000
- `erc20_transfer` has new transfers at blocks 1001-1100

**Expected Result:**
- Query returns only transfers at block > 1000 for accounts A, B, C
- Query returns all transfers for accounts that don't exist in balances yet

**Verification:**
```sql
-- Transfers for existing accounts should only be from newer blocks
SELECT t.block_num, t.to, t.from
FROM erc20_transfer t
WHERE t.to IN (SELECT account FROM erc20_balances_rpc)
  OR t.from IN (SELECT account FROM erc20_balances_rpc);
-- All returned block_num should be > MAX(block_num) in erc20_balances_rpc for that account
```

## Test Scenario 3: No New Transfers

**Setup:**
- `erc20_balances_rpc` has balances at block 2000
- Latest transfer in `erc20_transfer` is at block 1999

**Expected Result:**
- Query returns empty result set
- No RPC calls should be made

**Verification:**
```sql
-- Should return 0 rows
SELECT COUNT(*)
FROM erc20_transfer t
WHERE t.block_num > (SELECT MAX(block_num) FROM erc20_balances_rpc);
-- Should be 0
```

## Test Scenario 4: Mixed State (Some Updated, Some Not)

**Setup:**
- Account A: last balance at block 1000
- Account B: last balance at block 1500
- Account C: no balance yet
- New transfers: blocks 1200, 1600, 1800

**Expected Result:**
- Transfer at 1200: Include for account A (1200 > 1000), skip for account B (1200 < 1500)
- Transfer at 1600: Include for account A and B (both newer)
- Transfer at 1800: Include for all accounts
- All transfers involving account C are included

**Verification:**
```sql
-- For account A: should get blocks 1200, 1600, 1800
-- For account B: should get blocks 1600, 1800
-- For account C: should get all transfers involving C
```

## Test Scenario 5: Error Handling (Failed Balance Queries)

**Setup:**
- `erc20_balances_rpc` has some entries with `is_ok = 0` (errors)
- These error entries have block_num set

**Expected Result:**
- Query should ignore error entries (is_ok = 0) when checking last known block
- Failed balances should be retried on subsequent runs

**Verification:**
```sql
-- Error entries should not prevent re-querying
SELECT * FROM erc20_balances_rpc WHERE is_ok = 0;
-- These accounts should appear in the next query result
```

## Test Scenario 6: Black Hole Address

**Setup:**
- Transfer from Black Hole address (T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb) at block 1500
- Transfer to normal account at same block

**Expected Result:**
- Query returns the transfer (SQL doesn't filter by address)
- Service-level logic skips processing the 'from' address if it's a black hole
- Only the 'to' account gets processed

**Verification:**
```sql
-- Query should include transfers from black hole
SELECT * FROM erc20_transfer WHERE `from` = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
-- Service code filters this out during processing
```

## Performance Considerations

### Index Usage
The query should efficiently use indexes on:
- `erc20_balances_rpc.contract` and `.account`
- `erc20_balances_rpc.block_num`
- `erc20_transfer.log_address`, `.from`, `.to`, `.block_num`

### Query Plan Verification
```sql
EXPLAIN SELECT ... -- Check if indexes are used
```

Expected:
- Index scans, not full table scans
- JOIN operations using indexed columns
- Efficient aggregation in CTEs

## Integration Test

To manually verify the implementation works:

1. Start with empty `erc20_balances_rpc`
2. Run `npm run balances` - should process many transfers
3. Check inserted records have `block_num` populated
4. Run `npm run balances` again - should process fewer/no transfers
5. Verify no duplicate balance queries were made

## Edge Cases

### Case 1: Multiple transfers in same block
- Should process all transfers from that block for an account
- All get the same block_num stored

### Case 2: Transfers from same account at different blocks
- First run: processes transfer at block 1000, stores block_num=1000
- Second run: processes transfer at block 2000, updates with block_num=2000
- ReplacingMergeTree ensures only latest is kept

### Case 3: Very large result sets
- LIMIT 10000 prevents query from becoming too large
- Service can be run multiple times to process all data incrementally
