import { describe, test, expect } from 'bun:test';
import { transformSqlForCluster, splitSqlStatements, executeSqlSetup } from './setup';

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
    test('should parse metadata schema', async () => {
        const functionsSql = await Bun.file('./sql/schema.metadata.sql').text();
        const functionsStatements = splitSqlStatements(functionsSql);
        
        expect(functionsStatements.length).toBeGreaterThan(0);
    });

    test('should parse metadata schema', async () => {
        const metadataSql = await Bun.file('./sql/schema.metadata.sql').text();
        const metadataStatements = splitSqlStatements(metadataSql);
        
        expect(metadataStatements.length).toBeGreaterThan(0);
    });

    test('should parse balances schema', async () => {
        const balancesSql = await Bun.file('./sql/schema.trc20_balances.sql').text();
        const balancesStatements = splitSqlStatements(balancesSql);
        
        expect(balancesStatements.length).toBeGreaterThan(0);
    });

    test('should transform metadata schema for cluster', async () => {
        const metadataSql = await Bun.file('./sql/schema.metadata.sql').text();
        const transformedMetadata = transformSqlForCluster(metadataSql, 'test_cluster');
        
        expect(transformedMetadata).toContain("ON CLUSTER 'test_cluster'");
        expect(transformedMetadata).toContain('ReplicatedReplacingMergeTree');
    });
});

describe('error handling', () => {
    test('should provide helpful error for non-SQL file', async () => {
        try {
            await executeSqlSetup(['nonexistent-cluster-name'], {});
            expect(true).toBe(false); // Should not reach here
        } catch (error) {
            const err = error as Error;
            expect(err.message).toContain('File not found');
            expect(err.message).toContain('--cluster');
            expect(err.message).toContain('nonexistent-cluster-name');
        }
    });

    test('should provide simple error for SQL file not found', async () => {
        try {
            await executeSqlSetup(['nonexistent.sql'], {});
            expect(true).toBe(false); // Should not reach here
        } catch (error) {
            const err = error as Error;
            expect(err.message).toContain('File not found');
            expect(err.message).not.toContain('--cluster'); // Should not suggest cluster for .sql files
        }
    });
});

describe('showClusters', () => {
    test('should export showClusters function', async () => {
        const { showClusters } = await import('./setup');
        expect(typeof showClusters).toBe('function');
    });
});

describe('promptClusterSelection', () => {
    test('should export promptClusterSelection function', async () => {
        const { promptClusterSelection } = await import('./setup');
        expect(typeof promptClusterSelection).toBe('function');
    });
});
