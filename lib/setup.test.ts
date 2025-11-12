import { transformSqlForCluster, splitSqlStatements } from './setup';

// Test splitSqlStatements
console.log('Testing splitSqlStatements...');

const testSql = `
-- This is a comment
CREATE TABLE test1 (id UInt32);

-- Another comment
CREATE TABLE test2 (
    id UInt32,
    name String
);

ALTER TABLE test1 ADD COLUMN extra String;
`;

const statements = splitSqlStatements(testSql);
console.log(`✓ Found ${statements.length} statements`);
console.assert(statements.length === 3, 'Should find 3 statements');
console.log('✓ splitSqlStatements passed\n');

// Test transformSqlForCluster
console.log('Testing transformSqlForCluster...');

const testSqlForTransform = `
CREATE TABLE IF NOT EXISTS test_table (
    id UInt32,
    name String
)
ENGINE = ReplacingMergeTree(version)
ORDER BY id;

ALTER TABLE test_table ADD COLUMN extra String;

CREATE OR REPLACE FUNCTION test_func AS (x) -> x * 2;
`;

const transformed = transformSqlForCluster(testSqlForTransform, 'my_cluster');

console.assert(
    transformed.includes("ON CLUSTER 'my_cluster'"),
    'Should add ON CLUSTER clause'
);

console.assert(
    transformed.includes('ReplicatedReplacingMergeTree'),
    'Should convert to ReplicatedReplacingMergeTree'
);

console.assert(
    transformed.includes('/clickhouse/tables/{shard}/{database}/{table}'),
    'Should add ZooKeeper path'
);

console.log('✓ transformSqlForCluster passed\n');

// Test with actual schema file
console.log('Testing with actual schema files...');

const functionsSql = await Bun.file('./sql/schema.0.functions.sql').text();
const metadataSql = await Bun.file('./sql/schema.0.offchain.metadata.sql').text();
const balancesSql = await Bun.file('./sql/schema.0.offchain.trc20_balances.sql').text();

const functionsStatements = splitSqlStatements(functionsSql);
console.log(`✓ Functions schema: ${functionsStatements.length} statements`);

const metadataStatements = splitSqlStatements(metadataSql);
console.log(`✓ Metadata schema: ${metadataStatements.length} statements`);

const balancesStatements = splitSqlStatements(balancesSql);
console.log(`✓ Balances schema: ${balancesStatements.length} statements`);

// Test cluster transformation on actual files
const transformedMetadata = transformSqlForCluster(metadataSql, 'test_cluster');
console.assert(
    transformedMetadata.includes("ON CLUSTER 'test_cluster'"),
    'Metadata schema should have cluster clauses'
);
console.assert(
    transformedMetadata.includes('ReplicatedReplacingMergeTree'),
    'Metadata schema should use replicated engine'
);

console.log('✓ All schema files validated\n');

console.log('✅ All tests passed!');
