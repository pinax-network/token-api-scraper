#!/usr/bin/env bun
/**
 * Integration test for the setup CLI command
 * This test verifies that the setup command correctly processes SQL files
 * and transforms them for cluster deployment
 */

import { transformSqlForCluster, splitSqlStatements } from './setup';
import { readFileSync } from 'fs';
import { resolve } from 'path';

console.log('🧪 Setup CLI Integration Test\n');

// Test 1: Verify all schema files exist
console.log('Test 1: Checking schema files exist...');
const schemaFiles = [
    'sql/schema.0.functions.sql',
    'sql/schema.0.offchain.metadata.sql',
    'sql/schema.0.offchain.trc20_balances.sql'
];

let allFilesExist = true;
for (const file of schemaFiles) {
    const path = resolve(process.cwd(), file);
    try {
        readFileSync(path, 'utf8');
        console.log(`  ✓ ${file} exists`);
    } catch (error) {
        console.log(`  ✗ ${file} NOT FOUND`);
        allFilesExist = false;
    }
}

if (!allFilesExist) {
    console.error('❌ Some schema files are missing!');
    process.exit(1);
}

// Test 2: Verify SQL statements can be parsed
console.log('\nTest 2: Parsing SQL statements...');
let totalStatements = 0;
for (const file of schemaFiles) {
    const content = readFileSync(file, 'utf8');
    const statements = splitSqlStatements(content);
    totalStatements += statements.length;
    console.log(`  ✓ ${file}: ${statements.length} statements`);
}
console.log(`  Total: ${totalStatements} statements`);

// Test 3: Verify cluster transformation
console.log('\nTest 3: Testing cluster transformation...');
const clusterName = 'test_cluster';
let hasErrors = false;

for (const file of schemaFiles) {
    const content = readFileSync(file, 'utf8');
    const transformed = transformSqlForCluster(content, clusterName);
    
    // Check for ON CLUSTER clause
    const hasOnCluster = transformed.includes(`ON CLUSTER '${clusterName}'`);
    
    // Check for Replicated engines (only if original has MergeTree)
    const hasMergeTree = content.includes('MergeTree');
    const hasReplicated = transformed.includes('Replicated');
    
    if (hasMergeTree && !hasReplicated) {
        console.log(`  ✗ ${file}: MergeTree not converted to Replicated`);
        hasErrors = true;
    } else if (hasMergeTree) {
        console.log(`  ✓ ${file}: Correctly converted to Replicated engines`);
    } else {
        console.log(`  ✓ ${file}: No MergeTree engines (functions only)`);
    }
    
    if (!hasOnCluster && (content.includes('CREATE') || content.includes('ALTER'))) {
        console.log(`  ✗ ${file}: ON CLUSTER clause not added`);
        hasErrors = true;
    }
}

if (hasErrors) {
    console.error('\n❌ Cluster transformation has errors!');
    process.exit(1);
}

// Test 4: Verify statement structure
console.log('\nTest 4: Verifying statement structure...');
const metadataContent = readFileSync('sql/schema.0.offchain.metadata.sql', 'utf8');
const statements = splitSqlStatements(metadataContent);

// Should have CREATE TABLE, ALTER TABLE statements
const hasCreateTable = statements.some(s => s.includes('CREATE TABLE'));
const hasAlterTable = statements.some(s => s.includes('ALTER TABLE'));

if (!hasCreateTable) {
    console.log('  ✗ No CREATE TABLE statement found');
    hasErrors = true;
} else {
    console.log('  ✓ CREATE TABLE statement found');
}

if (!hasAlterTable) {
    console.log('  ✗ No ALTER TABLE statement found');
    hasErrors = true;
} else {
    console.log('  ✓ ALTER TABLE statement found');
}

// Test 5: Verify table names match expected values
console.log('\nTest 5: Verifying table names...');
const expectedTables = ['metadata_rpc', 'trc20_balances_rpc', 'native_balances_rpc'];
const allContent = schemaFiles.map(f => readFileSync(f, 'utf8')).join('\n');

for (const table of expectedTables) {
    if (allContent.includes(table)) {
        console.log(`  ✓ Table ${table} defined`);
    } else {
        console.log(`  ✗ Table ${table} NOT FOUND`);
        hasErrors = true;
    }
}

// Test 6: Verify functions are defined
console.log('\nTest 6: Verifying helper functions...');
const functionsContent = readFileSync('sql/schema.0.functions.sql', 'utf8');
const expectedFunctions = ['hex_to_string', 'hex_to_uint256', 'format_balance'];

for (const func of expectedFunctions) {
    if (functionsContent.includes(func)) {
        console.log(`  ✓ Function ${func} defined`);
    } else {
        console.log(`  ✗ Function ${func} NOT FOUND`);
        hasErrors = true;
    }
}

if (hasErrors) {
    console.error('\n❌ Integration test failed!');
    process.exit(1);
}

console.log('\n✅ All integration tests passed!');
console.log('\nThe setup command is ready to use:');
console.log('  npm run cli setup sql/schema.*.sql');
console.log('  npm run cli setup sql/schema.*.sql --cluster my_cluster');
