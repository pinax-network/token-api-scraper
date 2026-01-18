# RPC Batch Requests

This document describes the RPC batch request feature that allows multiple JSON-RPC calls to be sent in a single HTTP request.

## Overview

The RPC batch request feature implements the JSON-RPC 2.0 batch specification, allowing multiple RPC calls to be bundled together. This can significantly improve performance by reducing network overhead and latency when making multiple RPC calls.

## Usage

### Low-Level API

#### makeBatchJsonRpcCall

Execute multiple JSON-RPC requests in a single batch:

```typescript
import { makeBatchJsonRpcCall, BatchRequest } from './lib/rpc';

const requests: BatchRequest[] = [
  { method: "eth_blockNumber", params: [] },
  { method: "eth_gasPrice", params: [] }
];

const results = await makeBatchJsonRpcCall(requests);

for (const result of results) {
  if (result.success) {
    console.log("Result:", result.result);
  } else {
    console.error("Error:", result.error);
  }
}
```

### High-Level API

#### batchCallContracts

Call multiple contract methods in a single batch:

```typescript
import { batchCallContracts, ContractCallRequest } from './lib/rpc';

const calls: ContractCallRequest[] = [
  { contract: "TCCA2WH8e1EJEUNkt1FNwmEjWWbgZm28vb", signature: "decimals()" },
  { contract: "TCCA2WH8e1EJEUNkt1FNwmEjWWbgZm28vb", signature: "symbol()" },
  { contract: "TCCA2WH8e1EJEUNkt1FNwmEjWWbgZm28vb", signature: "name()" }
];

const results = await batchCallContracts(calls);

// Process results in the same order as requests
for (let i = 0; i < results.length; i++) {
  if (results[i].success) {
    console.log(`Call ${i} result:`, results[i].result);
  } else {
    console.error(`Call ${i} error:`, results[i].error);
  }
}
```

#### batchCallContracts with Arguments

```typescript
const calls: ContractCallRequest[] = [
  { 
    contract: "TCCA2WH8e1EJEUNkt1FNwmEjWWbgZm28vb", 
    signature: "balanceOf(address)", 
    args: ["TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ"] 
  },
  { 
    contract: "TCCA2WH8e1EJEUNkt1FNwmEjWWbgZm28vb", 
    signature: "allowance(address,address)", 
    args: ["TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ", "TAnotherAddress..."] 
  }
];

const results = await batchCallContracts(calls);
```

## Error Handling

Batch requests handle errors at multiple levels:

1. **Transport Errors**: Network errors, timeouts, HTTP errors
   - Automatically retried based on retry configuration
   - Returns error for all requests in the batch

2. **Individual Request Errors**: Errors from specific RPC calls
   - Each request result has a `success` flag
   - Failed requests include error code and message
   - Other requests in the batch are not affected

Example:

```typescript
const results = await batchCallContracts(calls);

for (const result of results) {
  if (result.success) {
    // Handle successful result
    processResult(result.result);
  } else {
    // Handle individual error
    console.error("Request failed:", result.error);
  }
}
```

## Retry Configuration

Batch requests support the same retry configuration as single requests:

```typescript
const results = await batchCallContracts(calls, {
  retries: 3,
  baseDelayMs: 400,
  timeoutMs: 10000,
  jitterMin: 0.7,
  jitterMax: 1.3,
  maxDelayMs: 30000
});
```

## Performance Considerations

### Benefits
- **Reduced Network Overhead**: Single HTTP request instead of multiple
- **Lower Latency**: Fewer round trips to the RPC endpoint
- **Better Throughput**: RPC endpoints can optimize batch processing

### Trade-offs
- **Batch Size**: Larger batches reduce overhead but may exceed endpoint limits
- **Error Isolation**: Single transport error affects all requests in batch
- **Memory Usage**: Larger batches require more memory for results

### Recommendations
- Start with batch size of 10-20 requests
- Monitor RPC endpoint response times
- Adjust batch size based on endpoint capabilities
- Use batch functions for metadata/balance queries where latency is important

## Testing

Run batch RPC tests:

```bash
bun test lib/rpc-batch.test.ts
```

The test suite includes:
- Empty batch handling
- Multiple request batches
- Contract calls with and without arguments
- Native balance queries
- Error handling within batches
- Order preservation
- Retry options

## Alignment with PR #61

This RPC batch feature is complementary to PR #61 (ClickHouse batch inserts):

- **PR #61**: Batches database INSERT operations
- **This PR**: Batches RPC calls to blockchain node

Together, they optimize both:
1. Data fetching from blockchain (RPC batches)
2. Data storage to database (ClickHouse batches)

Both features use similar configuration patterns and are opt-in for backward compatibility.
