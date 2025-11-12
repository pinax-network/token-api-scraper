/**
 * Polyfill for the global 'proto' variable required by tronweb's generated protobuf files.
 * 
 * Background:
 * TronWeb 6.0.4's generated CommonJS protobuf files contain a bug where they reference
 * a global 'proto' variable that doesn't exist. For example, in files like:
 * - node_modules/tronweb/lib/commonjs/protocol/core/contract/balance_contract_pb.cjs
 * - node_modules/tronweb/lib/commonjs/protocol/core/Tron_pb.cjs
 * 
 * These files contain code like:
 * ```javascript
 * var core_contract_common_pb = require('../../core/contract/common_pb.cjs');
 * goog.object.extend(proto, core_contract_common_pb);
 * ```
 * 
 * The 'proto' variable is never defined, causing a ReferenceError when these modules
 * are loaded in environments like Bun.
 * 
 * Solution:
 * This polyfill defines a global 'proto' object that the generated code can extend.
 * The object is attached to globalThis to ensure it's available in all contexts.
 */

// Define the global proto namespace if it doesn't exist
if (typeof globalThis.proto === 'undefined') {
  (globalThis as any).proto = {};
}

// Export a reference for TypeScript type checking
export const proto = (globalThis as any).proto;
