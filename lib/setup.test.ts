import { describe, test, expect } from 'bun:test';
import { transformSqlForCluster, splitSqlStatements } from './setup';

describe('splitSqlStatements', () => {
    test('should split SQL statements correctly', () => {
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
        expect(statements.length).toBe(3);
    });
});

describe('transformSqlForCluster', () => {
    test('should add ON CLUSTER clause', () => {
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
        
        expect(transformed).toContain("ON CLUSTER 'my_cluster'");
    });

    test('should convert to ReplicatedReplacingMergeTree', () => {
        const testSqlForTransform = `
CREATE TABLE IF NOT EXISTS test_table (
    id UInt32,
    name String
)
ENGINE = ReplacingMergeTree(version)
ORDER BY id;
`;

        const transformed = transformSqlForCluster(testSqlForTransform, 'my_cluster');
        
        expect(transformed).toContain('ReplicatedReplacingMergeTree');
    });

    test('should add ZooKeeper path', () => {
        const testSqlForTransform = `
CREATE TABLE IF NOT EXISTS test_table (
    id UInt32,
    name String
)
ENGINE = ReplacingMergeTree(version)
ORDER BY id;
`;

        const transformed = transformSqlForCluster(testSqlForTransform, 'my_cluster');
        
        expect(transformed).toContain('/clickhouse/tables/{shard}/{database}/{table}');
    });
});

describe('schema files', () => {
    test('should parse functions schema', async () => {
        const functionsSql = await Bun.file('./sql/schema.0.functions.sql').text();
        const functionsStatements = splitSqlStatements(functionsSql);
        
        expect(functionsStatements.length).toBeGreaterThan(0);
    });

    test('should parse metadata schema', async () => {
        const metadataSql = await Bun.file('./sql/schema.0.offchain.metadata.sql').text();
        const metadataStatements = splitSqlStatements(metadataSql);
        
        expect(metadataStatements.length).toBeGreaterThan(0);
    });

    test('should parse balances schema', async () => {
        const balancesSql = await Bun.file('./sql/schema.0.offchain.trc20_balances.sql').text();
        const balancesStatements = splitSqlStatements(balancesSql);
        
        expect(balancesStatements.length).toBeGreaterThan(0);
    });

    test('should transform metadata schema for cluster', async () => {
        const metadataSql = await Bun.file('./sql/schema.0.offchain.metadata.sql').text();
        const transformedMetadata = transformSqlForCluster(metadataSql, 'test_cluster');
        
        expect(transformedMetadata).toContain("ON CLUSTER 'test_cluster'");
        expect(transformedMetadata).toContain('ReplicatedReplacingMergeTree');
    });
});
