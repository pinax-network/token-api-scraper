# Proto Variable Fix for TronWeb

## Problem

TronWeb 6.0.4's generated CommonJS protobuf files contain a bug where they reference a global `proto` variable that doesn't exist. This causes a `ReferenceError: Can't find variable: proto` when running tests with Bun.

### Technical Details

The generated protobuf files (e.g., `node_modules/tronweb/lib/commonjs/protocol/core/contract/balance_contract_pb.cjs`) contain code like:

```javascript
var core_contract_common_pb = require('../../core/contract/common_pb.cjs');
goog.object.extend(proto, core_contract_common_pb);
```

The `proto` variable is never defined in these files, causing a runtime error when the modules are loaded.

## Solution

We've implemented a polyfill that defines the global `proto` object before any TronWeb code is loaded:

1. **Polyfill File**: `lib/proto-polyfill.ts` defines `globalThis.proto = {}` if it doesn't exist
2. **Bun Configuration**: `bunfig.toml` preloads the polyfill before running tests
3. **Import Guards**: Files that import from tronweb (`lib/rpc.ts`, `src/utils.ts`) explicitly import the polyfill first

### Files Modified

- `lib/proto-polyfill.ts` (new): Defines the global proto object
- `bunfig.toml` (new): Configures Bun to preload the polyfill
- `lib/rpc.ts`: Imports polyfill before tronweb
- `src/utils.ts`: Imports polyfill before tronweb

## Testing

The fix ensures that:
1. Tests can run without the "Can't find variable: proto" error
2. The global `proto` object is available before any tronweb code executes
3. No changes are needed to the actual application logic

## Future Considerations

This is a workaround for a bug in TronWeb's code generation. The proper fix would be for TronWeb to regenerate their protobuf files with the correct code. We should:

1. Report this issue to the TronWeb repository
2. Check for updates in future versions of TronWeb that might fix this
3. Remove this workaround when TronWeb releases a fixed version
